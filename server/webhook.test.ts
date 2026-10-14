import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundStore } from "./ingest.js";
import { formatPhoneBr, normalizePhone, phoneKey } from "./phone.js";
import { verifySignature } from "./signature.js";
import { handleIncoming, handleVerification, type WebhookEnv } from "./webhook-handler.js";
import { parseWebhookPayload } from "./whatsapp-parse.js";

const APP_SECRET = "segredo-de-teste";
const VERIFY_TOKEN = "token-de-teste";
const env = { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN };

const sign = (body: string, secret = APP_SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

function payload(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              contacts: [{ wa_id: "553188880002", profile: { name: "Maria Teste" } }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

const textMsg = (id: string, body = "Oi, quero fazer uma mudança", from = "553188880002") => ({
  from,
  id,
  timestamp: "1790000000",
  type: "text",
  text: { body },
});

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("https://crm.amitran.test/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

/** Banco de mentira em memória, com as mesmas regras do real (id único, só avança datas). */
function fakeStore() {
  const conversations = new Map<string, { id: string; telefoneNorm: string; contactName: string | null; status?: string; lastInboundAt?: string; lastMessageAt?: string }>();
  const messages = new Map<string, { conversationId: string; type: string; content: string | null; direction?: string; status?: string; error?: string | null }>();
  const store: InboundStore = {
    async upsertConversation({ waId, telefoneNorm, contactName }) {
      const existing = conversations.get(waId);
      if (existing) {
        existing.telefoneNorm = telefoneNorm;
        if (contactName) existing.contactName = contactName;
        return existing.id;
      }
      const id = `conv-${conversations.size + 1}`;
      conversations.set(waId, { id, telefoneNorm, contactName });
      return id;
    },
    async insertInboundMessage({ conversationId, message }) {
      if (messages.has(message.whatsappMessageId)) return false;
      messages.set(message.whatsappMessageId, { conversationId, type: message.type, content: message.content, direction: "inbound", status: "received" });
      return true;
    },
    async insertOutboundEcho({ conversationId, echo }) {
      if (messages.has(echo.whatsappMessageId)) return false;
      messages.set(echo.whatsappMessageId, { conversationId, type: echo.type, content: echo.content, direction: "outbound", status: "sent" });
      return true;
    },
    async markHumanActivity(conversationId, at) {
      for (const c of conversations.values()) {
        if (c.id !== conversationId) continue;
        c.status = "human";
        if (!c.lastMessageAt || c.lastMessageAt < at) c.lastMessageAt = at;
      }
    },
    async applyStatus({ whatsappMessageId, status, allowedPrevious, errorText }) {
      const m = messages.get(whatsappMessageId);
      if (!m || m.direction !== "outbound" || !allowedPrevious.includes(m.status ?? "")) return false;
      m.status = status;
      if (errorText) m.error = errorText;
      return true;
    },
    async touchConversation(conversationId, at) {
      for (const c of conversations.values()) {
        if (c.id !== conversationId) continue;
        if (!c.lastInboundAt || c.lastInboundAt < at) c.lastInboundAt = at;
        if (!c.lastMessageAt || c.lastMessageAt < at) c.lastMessageAt = at;
      }
    },
  };
  return { store, conversations, messages };
}

describe("verifySignature", () => {
  const body = Buffer.from('{"a":1}');
  it("aceita assinatura correta", () => {
    expect(verifySignature(body, sign('{"a":1}'), APP_SECRET)).toBe(true);
  });
  it("recusa assinatura de outro segredo, ausente ou malformada", () => {
    expect(verifySignature(body, sign('{"a":1}', "outro"), APP_SECRET)).toBe(false);
    expect(verifySignature(body, null, APP_SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=", APP_SECRET)).toBe(false);
    expect(verifySignature(body, "abc", APP_SECRET)).toBe(false);
    expect(verifySignature(body, sign('{"a":1}'), "")).toBe(false);
  });
  it("recusa se o corpo foi alterado em 1 byte", () => {
    expect(verifySignature(Buffer.from('{"a":2}'), sign('{"a":1}'), APP_SECRET)).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("acrescenta o 9º dígito em celular brasileiro sem ele", () => {
    expect(normalizePhone("553188880002")).toBe("5531988880002");
  });
  it("mantém celular que já tem 9 dígitos e telefone fixo", () => {
    expect(normalizePhone("5531988880002")).toBe("5531988880002");
    expect(normalizePhone("553133334444")).toBe("553133334444");
  });
  it("não mexe em número de outro país", () => {
    expect(normalizePhone("351912345678")).toBe("351912345678");
  });
});

describe("phoneKey / formatPhoneBr (comparar e mostrar telefones)", () => {
  it("telefones escritos de jeitos diferentes viram a mesma chave", () => {
    const k = phoneKey("553188880001");
    for (const v of ["+55 31 98888-0001", "(31) 98888-0001", "31988880001", "5531988880001", "+55 31 8888-0001"]) expect(phoneKey(v)).toBe(k);
    expect(phoneKey("+55 31 99999-0000")).not.toBe(k);
  });
  it("texto sem telefone não gera chave (nunca casa por engano)", () => {
    expect(phoneKey("CONFERIR")).toBe("");
    expect(phoneKey("xxxxxxxx")).toBe("");
    expect(phoneKey("")).toBe("");
  });
  it("formata no padrão que o CRM já usa", () => {
    expect(formatPhoneBr("5531988880001")).toBe("+55 31 98888-0001");
    expect(formatPhoneBr("553133334444")).toBe("+55 31 3333-4444");
    expect(formatPhoneBr("16315551181")).toBe("+16315551181");
  });
});

describe("parseWebhookPayload", () => {
  it("lê texto, nome do contato e horário", () => {
    const r = parseWebhookPayload(payload([textMsg("wamid.1")]));
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      waId: "553188880002",
      contactName: "Maria Teste",
      whatsappMessageId: "wamid.1",
      type: "text",
      content: "Oi, quero fazer uma mudança",
      waTimestamp: new Date(1790000000 * 1000).toISOString(),
    });
  });
  it("guarda tipos que ainda não tratamos em vez de perder", () => {
    const r = parseWebhookPayload(
      payload([{ from: "553188880002", id: "wamid.2", timestamp: "1790000001", type: "audio", audio: { id: "MEDIA1" } }]),
    );
    expect(r.messages[0]).toMatchObject({ type: "audio", content: null });
    expect((r.messages[0].payload as any).audio.id).toBe("MEDIA1");
  });
  it("extrai legenda, botão e lista", () => {
    const r = parseWebhookPayload(
      payload([
        { from: "553188880002", id: "a", type: "image", image: { id: "x", caption: "meu sofá" } },
        { from: "553188880002", id: "b", type: "interactive", interactive: { button_reply: { id: "1", title: "Sim" } } },
        { from: "553188880002", id: "c", type: "interactive", interactive: { list_reply: { id: "2", title: "Completo" } } },
      ]),
    );
    expect(r.messages.map((m) => m.content)).toEqual(["meu sofá", "Sim", "Completo"]);
  });
  it("ignora malformadas (sem id / número inválido) e conta atualizações de status", () => {
    const r = parseWebhookPayload(
      payload([{ from: "553188880002", type: "text" }, textMsg("wamid.3", "x", "abc")], { statuses: [{}, {}] }),
    );
    expect(r.messages).toHaveLength(0);
    expect(r.skipped).toBe(2);
    expect(r.statusCount).toBe(2);
  });
  it("não quebra com lixo", () => {
    expect(parseWebhookPayload(null).messages).toEqual([]);
    expect(parseWebhookPayload({ entry: "x" }).messages).toEqual([]);
    expect(parseWebhookPayload({ entry: [{ changes: [{ field: "outro", value: {} }] }] }).messages).toEqual([]);
  });
});

describe("parseWebhookPayload — status de entrega", () => {
  const statusPayload = (statuses: unknown[]) => payload([], { statuses });
  it("lê enviada / entregue / lida e ignora tipos desconhecidos", () => {
    const r = parseWebhookPayload(
      statusPayload([
        { id: "wamid.A", status: "sent", timestamp: "1790000000" },
        { id: "wamid.A", status: "delivered", timestamp: "1790000001" },
        { id: "wamid.A", status: "read", timestamp: "1790000002" },
        { id: "wamid.A", status: "deleted" },
        { status: "sent" },
      ]),
    );
    expect(r.statusCount).toBe(5);
    expect(r.statuses.map((s) => s.status)).toEqual(["sent", "delivered", "read"]);
    expect(r.statuses[0].at).toBe(new Date(1790000000 * 1000).toISOString());
  });
  it("resume o motivo da falha em uma linha", () => {
    const r = parseWebhookPayload(
      statusPayload([
        { id: "wamid.B", status: "failed", errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "Message failed: more than 24 hours" } }] },
      ]),
    );
    expect(r.statuses[0].errorText).toBe("131047 · Re-engagement message · Message failed: more than 24 hours");
  });
});

describe("status de entrega via webhook (POST)", () => {
  let db: ReturnType<typeof fakeStore>;
  const run = (body: string) =>
    handleIncoming(post(body, { "x-hub-signature-256": sign(body) }), { env, getStore: () => db.store });

  beforeEach(() => {
    db = fakeStore();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // mensagem NOSSA já enviada
    db.messages.set("wamid.OUT", { conversationId: "conv-1", type: "text", content: "Olá!", direction: "outbound", status: "sent" });
  });

  const st = (status: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify(payload([], { statuses: [{ id: "wamid.OUT", status, timestamp: "1790000000", ...extra }] }));

  it("avança sent → delivered → read", async () => {
    expect((await run(st("delivered"))).status).toBe(200);
    expect(db.messages.get("wamid.OUT")?.status).toBe("delivered");
    expect((await run(st("read"))).status).toBe(200);
    expect(db.messages.get("wamid.OUT")?.status).toBe("read");
  });
  it("não volta para trás se os avisos chegarem fora de ordem", async () => {
    await run(st("read"));
    await run(st("delivered"));
    await run(st("sent"));
    expect(db.messages.get("wamid.OUT")?.status).toBe("read");
  });
  it("marca falha com o motivo, mas não derruba uma mensagem já lida", async () => {
    await run(st("failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }));
    expect(db.messages.get("wamid.OUT")).toMatchObject({ status: "failed", error: "131026 · Message undeliverable" });

    db.messages.set("wamid.READ", { conversationId: "conv-1", type: "text", content: "x", direction: "outbound", status: "read" });
    const body = JSON.stringify(payload([], { statuses: [{ id: "wamid.READ", status: "failed" }] }));
    await run(body);
    expect(db.messages.get("wamid.READ")?.status).toBe("read");
  });
  it("ignora status de mensagem desconhecida ou de mensagem do cliente (200, sem erro)", async () => {
    const unknown = JSON.stringify(payload([], { statuses: [{ id: "wamid.NAOEXISTE", status: "read" }] }));
    expect((await run(unknown)).status).toBe(200);
    db.messages.set("wamid.IN", { conversationId: "conv-1", type: "text", content: "oi", direction: "inbound", status: "received" });
    await run(JSON.stringify(payload([], { statuses: [{ id: "wamid.IN", status: "read" }] })));
    expect(db.messages.get("wamid.IN")?.status).toBe("received");
  });
  it("devolve 500 se o banco falhar ao aplicar status (a Meta reenvia)", async () => {
    db.store.applyStatus = async () => {
      throw new Error("banco fora do ar");
    };
    expect((await run(st("delivered"))).status).toBe(500);
  });
});

describe("Coexistence — mensagens digitadas no celular (smb_message_echoes)", () => {
  const echoPayload = (echoes: unknown[]) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "553188880002", phone_number_id: "123" },
              message_echoes: echoes,
            },
          },
        ],
      },
    ],
  });
  const echo = (id: string, extra: Record<string, unknown> = {}) => ({
    from: "553188880002",
    to: "553188880001",
    id,
    timestamp: "1790000000",
    type: "text",
    text: { body: "Oi, aqui é o Lucas da Amitran" },
    ...extra,
  });

  let db: ReturnType<typeof fakeStore>;
  const run = (body: string) =>
    handleIncoming(post(body, { "x-hub-signature-256": sign(body) }), { env, getStore: () => db.store });

  beforeEach(() => {
    db = fakeStore();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("lê a mensagem do celular (destinatário = cliente) e ignora malformadas", () => {
    const r = parseWebhookPayload(echoPayload([echo("wamid.E1"), { from: "1", id: "wamid.E2" }, echo("wamid.E3", { to: "abc" })]));
    expect(r.echoes).toHaveLength(1);
    expect(r.echoes[0]).toMatchObject({ waId: "553188880001", whatsappMessageId: "wamid.E1", type: "text", content: "Oi, aqui é o Lucas da Amitran" });
    expect(r.skipped).toBe(2);
    expect(r.messages).toHaveLength(0);
  });

  it("grava como mensagem de SAÍDA, passa a conversa para humano e usa o telefone normalizado", async () => {
    const body = JSON.stringify(echoPayload([echo("wamid.E1")]));
    expect((await run(body)).status).toBe(200);
    const m = db.messages.get("wamid.E1");
    expect(m).toMatchObject({ direction: "outbound", status: "sent", content: "Oi, aqui é o Lucas da Amitran" });
    const conv = [...db.conversations.values()][0];
    expect(conv).toMatchObject({ telefoneNorm: "5531988880001", status: "human" });
    expect(conv.lastInboundAt).toBeUndefined(); // o cliente ainda não escreveu: não abre janela de 24h
    expect(conv.lastMessageAt).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it("é idempotente e não confunde com mensagem do cliente", async () => {
    const body = JSON.stringify(echoPayload([echo("wamid.E1")]));
    await run(body);
    await run(body);
    expect(db.messages.size).toBe(1);
    expect(db.conversations.size).toBe(1);
  });

  it("falha no banco => 500 (a Meta reenvia)", async () => {
    db.store.insertOutboundEcho = async () => {
      throw new Error("banco fora do ar");
    };
    expect((await run(JSON.stringify(echoPayload([echo("wamid.E1")])))).status).toBe(500);
  });
});

describe("aviso à IA depois de gravar (onInboundStored)", () => {
  let db: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    db = fakeStore();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const run = (body: string, onInboundStored?: (ids: string[]) => void) =>
    handleIncoming(post(body, { "x-hub-signature-256": sign(body) }), { env, getStore: () => db.store, onInboundStored });

  it("avisa só das conversas com mensagem NOVA do cliente (uma vez por conversa)", async () => {
    const onInbound = vi.fn();
    const body = JSON.stringify(payload([textMsg("wamid.1"), textMsg("wamid.2", "segunda")]));
    await run(body, onInbound);
    expect(onInbound).toHaveBeenCalledTimes(1);
    expect(onInbound.mock.calls[0][0]).toHaveLength(1);
  });

  it("repetição do mesmo webhook, status e mensagens do celular NÃO acionam a IA", async () => {
    const onInbound = vi.fn();
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    await run(body, onInbound);
    onInbound.mockClear();
    await run(body, onInbound); // duplicada
    await run(JSON.stringify(payload([], { statuses: [{ id: "wamid.1", status: "read" }] })), onInbound);
    expect(onInbound).not.toHaveBeenCalled();
  });

  it("se o aviso falhar, o webhook continua respondendo 200 (a Meta não reenvia)", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.9")]));
    const res = await run(body, () => {
      throw new Error("falhou");
    });
    expect(res.status).toBe(200);
    expect(db.messages.size).toBe(1);
  });
});

describe("handleVerification (GET)", () => {
  const url = (q: string) => new Request(`https://x/api/whatsapp/webhook?${q}`);
  it("devolve o desafio quando o token confere", async () => {
    const res = handleVerification(url(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });
  it("recusa token errado, modo errado ou sem desafio", () => {
    expect(handleVerification(url("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1"), env).status).toBe(403);
    expect(handleVerification(url(`hub.mode=outro&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`), env).status).toBe(403);
    expect(handleVerification(url(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`), env).status).toBe(403);
  });
  it("sem token configurado, recusa tudo", () => {
    expect(handleVerification(url("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), {}).status).toBe(500);
  });
});

describe("handleIncoming (POST)", () => {
  let db: ReturnType<typeof fakeStore>;
  const run = (req: Request, e: WebhookEnv = env) => handleIncoming(req, { env: e, getStore: () => db.store });

  beforeEach(() => {
    db = fakeStore();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("grava a mensagem quando a assinatura é válida", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    const res = await run(post(body, { "x-hub-signature-256": sign(body) }));
    expect(res.status).toBe(200);
    expect(db.messages.size).toBe(1);
    const conv = [...db.conversations.values()][0];
    expect(conv).toMatchObject({ telefoneNorm: "5531988880002", contactName: "Maria Teste" });
    expect(conv.lastInboundAt).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it("recusa (401) e NÃO grava com assinatura inválida ou ausente", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    expect((await run(post(body, { "x-hub-signature-256": sign(body, "outro") }))).status).toBe(401);
    expect((await run(post(body))).status).toBe(401);
    expect(db.messages.size).toBe(0);
    expect(db.conversations.size).toBe(0);
  });

  it("aceita mais de uma chave (nosso app + parceiro) e recusa as que não estão na lista", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    const both = { ...env, appSecret: `${APP_SECRET}, segredo-do-parceiro ,` };
    expect((await run(post(body, { "x-hub-signature-256": sign(body) }), both)).status).toBe(200);
    expect((await run(post(body, { "x-hub-signature-256": sign(body, "segredo-do-parceiro") }), both)).status).toBe(200);
    expect((await run(post(body, { "x-hub-signature-256": sign(body, "intruso") }), both)).status).toBe(401);
  });

  it("recusa tudo se o segredo do servidor não estiver configurado", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    const res = await run(post(body, { "x-hub-signature-256": sign(body, "") }), { verifyToken: VERIFY_TOKEN });
    expect(res.status).toBe(500);
    expect(db.messages.size).toBe(0);
  });

  it("é idempotente: o mesmo webhook 2x não duplica", async () => {
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    const headers = { "x-hub-signature-256": sign(body) };
    expect((await run(post(body, headers))).status).toBe(200);
    expect((await run(post(body, headers))).status).toBe(200);
    expect(db.messages.size).toBe(1);
    expect(db.conversations.size).toBe(1);
  });

  it("junta mensagens do mesmo número na mesma conversa e não volta no tempo", async () => {
    const newer = JSON.stringify(payload([{ ...textMsg("wamid.2"), timestamp: "1790000500" }]));
    const older = JSON.stringify(payload([{ ...textMsg("wamid.1"), timestamp: "1790000100" }]));
    await run(post(newer, { "x-hub-signature-256": sign(newer) }));
    await run(post(older, { "x-hub-signature-256": sign(older) }));
    expect(db.conversations.size).toBe(1);
    expect(db.messages.size).toBe(2);
    expect([...db.conversations.values()][0].lastInboundAt).toBe(new Date(1790000500 * 1000).toISOString());
  });

  it("responde 200 para atualização de status (sem mensagens) e para JSON de outro tipo", async () => {
    const body = JSON.stringify(payload([], { statuses: [{ id: "x", status: "delivered" }] }));
    expect((await run(post(body, { "x-hub-signature-256": sign(body) }))).status).toBe(200);
    expect(db.messages.size).toBe(0);
  });

  it("devolve 500 se o banco falhar (a Meta reenvia depois)", async () => {
    db.store.upsertConversation = async () => {
      throw new Error("banco fora do ar");
    };
    const body = JSON.stringify(payload([textMsg("wamid.1")]));
    expect((await run(post(body, { "x-hub-signature-256": sign(body) }))).status).toBe(500);
  });

  it("400 para corpo assinado mas que não é JSON; 413 para corpo gigante", async () => {
    const bad = "isto não é json";
    expect((await run(post(bad, { "x-hub-signature-256": sign(bad) }))).status).toBe(400);
    const huge = "x".repeat(4_000_001);
    expect((await run(post(huge, { "x-hub-signature-256": sign(huge) }))).status).toBe(413);
  });
});

describe("endereço ralo do Dualhook (sink)", () => {
  it("GET: confirma a verificação da Meta só com o token certo", async () => {
    const { handleSinkVerification } = await import("./sink-handler.js");
    const ok = handleSinkVerification(new Request(`https://x/dh?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=999`), env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("999");
    const bad = handleSinkVerification(new Request("https://x/dh?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=999"), env);
    expect(bad.status).toBe(403);
  });

  it("POST: responde 200 para qualquer corpo e não toca em nada", async () => {
    const { handleSinkDelivery } = await import("./sink-handler.js");
    for (const body of ['{"object":"whatsapp_business_account"}', "lixo", ""]) {
      const res = await handleSinkDelivery(new Request("https://x/dh", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=0000" } }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    }
  });
});
