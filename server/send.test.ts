import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSend, type AuthUser, type ConversationRow, type SendDeps, type SendStore } from "./send-handler.js";
import { sendWhatsappTemplate, sendWhatsappText } from "./whatsapp-send.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const OTHER_SELLER: AuthUser = { id: "u-other", role: "vendedor" };

const CONV_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const config = { accessToken: "token-de-teste", phoneNumberId: "123", apiVersion: "v25.0" };

function setup(overrides: { conversation?: Partial<ConversationRow> | null; user?: AuthUser | null; send?: SendDeps["send"] } = {}) {
  const conversation: ConversationRow | null =
    overrides.conversation === null
      ? null
      : { id: CONV_ID, wa_id: "5531988880001", assigned_seller_id: SELLER.id, last_inbound_at: hoursAgo(1), ...overrides.conversation };

  const inserted: Parameters<SendStore["insertOutboundMessage"]>[0][] = [];
  const humanReplied: string[] = [];
  const store: SendStore = {
    getConversation: async () => conversation,
    insertOutboundMessage: async (m) => void inserted.push(m),
    markHumanReplied: async (id) => void humanReplied.push(id),
  };
  const send = overrides.send ?? vi.fn(async () => ({ ok: true as const, wamid: "wamid.NOVO" }));
  const user = overrides.user === undefined ? SELLER : overrides.user;
  const deps: SendDeps = {
    config,
    authenticate: async (jwt) => (jwt === "jwt-valido" ? user : null),
    store,
    send,
    now: () => NOW,
  };
  return { deps, inserted, humanReplied, send };
}

const req = (body: unknown, headers: Record<string, string> = { authorization: "Bearer jwt-valido" }) =>
  new Request("https://crm.amitran.test/api/whatsapp/send", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = { conversation_id: CONV_ID, text: "Olá! Posso ajudar com a sua mudança?" };

describe("handleSend", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("vendedor responsável envia, grava a mensagem e passa a conversa para humano", async () => {
    const t = setup();
    const res = await handleSend(req(valid), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, whatsapp_message_id: "wamid.NOVO" });
    expect(t.send).toHaveBeenCalledWith(config, { to: "5531988880001", body: valid.text });
    expect(t.inserted).toEqual([
      { conversationId: CONV_ID, userId: SELLER.id, content: valid.text, whatsappMessageId: "wamid.NOVO", status: "sent", error: null },
    ]);
    expect(t.humanReplied).toEqual([CONV_ID]);
  });

  it("Head envia em conversa de qualquer vendedor e em conversa sem dono", async () => {
    expect((await handleSend(req(valid), setup({ user: HEAD }).deps)).status).toBe(200);
    expect((await handleSend(req(valid), setup({ user: HEAD, conversation: { assigned_seller_id: null } }).deps)).status).toBe(200);
  });

  it("vendedor NÃO envia em conversa de outro vendedor nem sem dono (404, nada enviado)", async () => {
    const other = setup({ user: OTHER_SELLER });
    expect((await handleSend(req(valid), other.deps)).status).toBe(404);
    const unassigned = setup({ conversation: { assigned_seller_id: null } });
    expect((await handleSend(req(valid), unassigned.deps)).status).toBe(404);
    expect(other.send).not.toHaveBeenCalled();
    expect(unassigned.send).not.toHaveBeenCalled();
    expect(other.inserted).toHaveLength(0);
  });

  it("conversa inexistente responde 404", async () => {
    const t = setup({ conversation: null });
    expect((await handleSend(req(valid), t.deps)).status).toBe(404);
    expect(t.send).not.toHaveBeenCalled();
  });

  it("sem login, token inválido ou perfil desconhecido => 401 e nada enviado", async () => {
    const t = setup();
    expect((await handleSend(req(valid, {}), t.deps)).status).toBe(401);
    expect((await handleSend(req(valid, { authorization: "Bearer invalido" }), t.deps)).status).toBe(401);
    expect((await handleSend(req(valid, { authorization: "jwt-valido" }), t.deps)).status).toBe(401);
    const noProfile = setup({ user: null });
    expect((await handleSend(req(valid), noProfile.deps)).status).toBe(401);
    expect(t.send).not.toHaveBeenCalled();
    expect(noProfile.send).not.toHaveBeenCalled();
  });

  it("dados inválidos => 400 (texto vazio, só espaços, grande demais, id errado, JSON quebrado)", async () => {
    const t = setup();
    for (const body of [
      { conversation_id: CONV_ID, text: "" },
      { conversation_id: CONV_ID, text: "   " },
      { conversation_id: CONV_ID, text: "x".repeat(4097) },
      { conversation_id: "nao-e-uuid", text: "oi" },
      {},
      "{quebrado",
    ]) {
      expect((await handleSend(req(body), t.deps)).status).toBe(400);
    }
    expect(t.send).not.toHaveBeenCalled();
  });

  it("janela de 24h: bloqueia (409) depois de 24h ou sem mensagem do cliente; libera dentro", async () => {
    const closed = setup({ conversation: { last_inbound_at: hoursAgo(24.5) } });
    const res = await handleSend(req(valid), closed.deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("janela_24h_fechada");
    expect(closed.send).not.toHaveBeenCalled();

    expect((await handleSend(req(valid), setup({ conversation: { last_inbound_at: null } }).deps)).status).toBe(409);
    expect((await handleSend(req(valid), setup({ conversation: { last_inbound_at: hoursAgo(23.9) } }).deps)).status).toBe(200);
  });

  it("falha da Meta => 502, grava a tentativa como 'failed' e NÃO passa para humano", async () => {
    const t = setup({ send: async () => ({ ok: false as const, error: "Meta recusou o envio (HTTP 400): 131030 · número não permitido" }) });
    const res = await handleSend(req(valid), t.deps);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toContain("131030");
    expect(t.inserted).toEqual([
      { conversationId: CONV_ID, userId: SELLER.id, content: valid.text, whatsappMessageId: null, status: "failed", error: expect.stringContaining("131030") },
    ]);
    expect(t.humanReplied).toHaveLength(0);
  });

  it("erro 131030 (fora da lista de permissão): tenta 1 vez com o número normalizado (9º dígito)", async () => {
    const calls: string[] = [];
    const send: SendDeps["send"] = async (_cfg, input) => {
      calls.push(input.to);
      return input.to === "5531988880001"
        ? { ok: true, wamid: "wamid.SEGUNDA" }
        : { ok: false, error: "Meta recusou o envio (HTTP 400): 131030 · não está na lista de permissão" };
    };
    const t = setup({ conversation: { wa_id: "553188880001", telefone_norm: "5531988880001" }, send });
    const res = await handleSend(req(valid), t.deps);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["553188880001", "5531988880001"]);
    // só o envio que deu certo é gravado (a 1ª tentativa não vira "failed")
    expect(t.inserted).toHaveLength(1);
    expect(t.inserted[0]).toMatchObject({ whatsappMessageId: "wamid.SEGUNDA", status: "sent" });
  });

  it("outros erros não disparam a 2ª tentativa; e se as duas falharem grava 'failed' uma vez", async () => {
    const other = vi.fn(async () => ({ ok: false, error: "Meta recusou o envio (HTTP 400): 131047 · fora da janela" }));
    const t1 = setup({ conversation: { wa_id: "553188880001", telefone_norm: "5531988880001" }, send: other });
    expect((await handleSend(req(valid), t1.deps)).status).toBe(502);
    expect(other).toHaveBeenCalledTimes(1);

    const both = vi.fn(async () => ({ ok: false, error: "Meta recusou o envio (HTTP 400): 131030 · lista" }));
    const t2 = setup({ conversation: { wa_id: "553188880001", telefone_norm: "5531988880001" }, send: both });
    expect((await handleSend(req(valid), t2.deps)).status).toBe(502);
    expect(both).toHaveBeenCalledTimes(2);
    expect(t2.inserted).toHaveLength(1);
    expect(t2.inserted[0].status).toBe("failed");
  });

  it("sem número alternativo (ou igual ao original) não repete", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "131030 · lista" }));
    const t = setup({ conversation: { wa_id: "16315551181", telefone_norm: "16315551181" }, send });
    await handleSend(req(valid), t.deps);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("apara espaços do texto antes de enviar", async () => {
    const t = setup();
    await handleSend(req({ conversation_id: CONV_ID, text: "  oi  " }), t.deps);
    expect(t.send).toHaveBeenCalledWith(config, { to: "5531988880001", body: "oi" });
  });
});

describe("sendWhatsappText", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("chama a Graph API com token no cabeçalho e devolve o wamid", async () => {
    const fetchMock = ok({ messages: [{ id: "wamid.XYZ" }] });
    const r = await sendWhatsappText(config, { to: "5531988880001", body: "oi" }, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, wamid: "wamid.XYZ" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-de-teste");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5531988880001",
      type: "text",
      text: { body: "oi", preview_url: false },
    });
  });

  it("usa o endereço base configurado (ex.: Dualhook) e recusa endereço sem https", async () => {
    const fetchMock = ok({ messages: [{ id: "wamid.DH" }] });
    const r = await sendWhatsappText({ ...config, apiBaseUrl: "https://api.dualhook.com/" }, { to: "5531988880001", body: "oi" }, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, wamid: "wamid.DH" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.dualhook.com/v25.0/123/messages");

    const bad = vi.fn();
    const r2 = await sendWhatsappText({ ...config, apiBaseUrl: "http://inseguro.com" }, { to: "1", body: "x" }, bad as unknown as typeof fetch);
    expect(r2.ok).toBe(false);
    expect(bad).not.toHaveBeenCalled();
  });

  it("erro da Meta vira mensagem curta, sem vazar o token", async () => {
    const fetchMock = ok({ error: { code: 190, message: "Invalid OAuth access token token-de-teste" } }, 401);
    const r = await sendWhatsappText(config, { to: "5531988880001", body: "oi" }, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("HTTP 401");
      expect(r.error).toContain("190");
      expect(r.error).not.toContain("token-de-teste");
      expect(r.error).toContain("[oculto]");
    }
  });

  it("não configurado, resposta sem id e erro de rede viram { ok:false } (nunca lançam)", async () => {
    expect((await sendWhatsappText({}, { to: "1", body: "x" })).ok).toBe(false);
    expect((await sendWhatsappText(config, { to: "1", body: "x" }, ok({ messages: [] }) as unknown as typeof fetch)).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await sendWhatsappText(config, { to: "1", body: "x" }, boom as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Falha de rede ao falar com a Meta" });
    expect(boom).toHaveBeenCalledTimes(2); // tentou de novo uma vez
  });

  it("falha de rede na 1ª tentativa e sucesso na 2ª: envia (uma mensagem só)", async () => {
    let n = 0;
    const flaky = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ messages: [{ id: "wamid.RETRY" }] }), { status: 200 });
    });
    const r = await sendWhatsappText(config, { to: "1", body: "x" }, flaky as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, wamid: "wamid.RETRY" });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("timeout NÃO é repetido (a mensagem pode ter saído)", async () => {
    const slow = vi.fn(async () => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    });
    const r = await sendWhatsappText(config, { to: "1", body: "x" }, slow as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, unconfirmed: true });
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("recusa da Meta (HTTP 4xx) não é repetida", async () => {
    const refuse = vi.fn(async () => new Response(JSON.stringify({ error: { code: 131042, message: "pagamento" } }), { status: 400 }));
    const r = await sendWhatsappText(config, { to: "1", body: "x" }, refuse as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(refuse).toHaveBeenCalledTimes(1);
  });
});

describe("sendWhatsappTemplate", () => {
  it("manda o modelo com os parâmetros do corpo na ordem", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.T1" }] }), { status: 200 }));
    const r = await sendWhatsappTemplate(
      config,
      { to: "553188880003", name: "novo_lead_qualificado", language: "pt_BR", bodyParams: ["Maria", "BH", "Contagem", "dia 15"] },
      fetchMock as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: true, wamid: "wamid.T1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "553188880003",
      type: "template",
      template: {
        name: "novo_lead_qualificado",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: ["Maria", "BH", "Contagem", "dia 15"].map((text) => ({ type: "text", text })) }],
      },
    });
  });

  it("devolve o motivo curto quando a Meta recusa (sem vazar o token)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 132001, message: "Template does not exist token-de-teste" } }), { status: 400 }));
    const r = await sendWhatsappTemplate(config, { to: "5531", name: "x", language: "pt_BR", bodyParams: [] }, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("132001");
    expect(r.error).not.toContain("token-de-teste");
  });
});
