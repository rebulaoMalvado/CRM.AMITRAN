import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCaption, handlePropostaPdf, handlePropostaSend, proposalFilename, type PropostaDeps } from "./proposta-handler.js";
import type { AuthUser, ConversationRow, SendStore } from "./send-handler.js";
import type { PropostaForm } from "../src/lib/proposta.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const OTHER: AuthUser = { id: "u-other", role: "vendedor" };
const DEAL = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const config = { accessToken: "dh_live_segredo", phoneNumberId: "997", apiBaseUrl: "https://api.dualhook.com" };

const form: PropostaForm = {
  nomeCliente: "Maria Souza", telefoneCliente: "+55 31 98888-0001", volumeEstimado: "20", dataMudanca: "2026-10-20",
  prazoExecucao: "1 dia", tipo: "Residencial", origem: "Santa Maria, BH", destino: "São Joaquim, BH", observacoes: "",
  valorMudanca: 3500, valorSeguro: "A DECLARAR", total: "R$ 3.500,00 + 2% do valor do seguro",
  nomeVendedor: "Raufle", emailVendedor: "raufle@amitran.com",
};

function setup(opts: {
  user?: AuthUser | null;
  dealOwner?: string;
  deal?: boolean;
  conversation?: Partial<ConversationRow> | null;
  render?: PropostaDeps["renderPdf"];
} = {}) {
  const inserted: Parameters<SendStore["insertOutboundMessage"]>[0][] = [];
  const marked: string[] = [];
  const humanReplied: string[] = [];
  const conv: ConversationRow | null =
    opts.conversation === null ? null : { id: "c1", wa_id: "553188880001", assigned_seller_id: SELLER.id, last_inbound_at: hoursAgo(1), ...opts.conversation };
  const renderPdf = opts.render ?? vi.fn(async () => new TextEncoder().encode("%PDF-1.7 conteudo"));
  const upload = vi.fn(async () => ({ ok: true, mediaId: "MEDIA9" }));
  const sendMedia = vi.fn(async () => ({ ok: true, wamid: "wamid.PROPOSTA" }));
  const user = opts.user === undefined ? SELLER : opts.user;
  const deps: PropostaDeps = {
    config,
    authenticate: async (jwt) => (jwt === "ok" ? user : null),
    store: { getConversation: async () => conv, insertOutboundMessage: async (m) => void inserted.push(m), markHumanReplied: async (id) => void humanReplied.push(id) },
    proposta: {
      getDealAccess: async () => (opts.deal === false ? null : { id: DEAL, seller_id: opts.dealOwner ?? SELLER.id, stage: "lead_novo", nome: "Maria" }),
      getConversationByDeal: async () => conv,
      markProposalSent: async (id) => void marked.push(id),
    },
    renderPdf,
    upload,
    sendMedia,
    now: () => NOW,
  };
  return { deps, inserted, marked, humanReplied, renderPdf, upload, sendMedia };
}

const req = (body: unknown, auth: string | null = "Bearer ok") =>
  new Request("https://x/api/proposta/enviar", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const body = (extra: Record<string, unknown> = {}) => ({ deal_id: DEAL, form, ...extra });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handlePropostaSend", () => {
  it("gera o PDF, envia como documento, registra na conversa e leva o lead para 'Orçamento enviado'", async () => {
    const t = setup();
    const res = await handlePropostaSend(req(body({ mark_sent: true })), t.deps);
    expect(res.status).toBe(200);
    expect(t.renderPdf).toHaveBeenCalledWith(form);
    expect(t.upload).toHaveBeenCalledTimes(1);
    expect(t.sendMedia).toHaveBeenCalledWith(config, expect.objectContaining({ to: "553188880001", kind: "document", mediaId: "MEDIA9", filename: "Proposta Amitran - Maria Souza.pdf" }));
    expect(t.inserted[0]).toMatchObject({ type: "document", status: "sent", whatsappMessageId: "wamid.PROPOSTA", payload: { document: { id: "MEDIA9", mime_type: "application/pdf" } } });
    expect(t.humanReplied).toEqual(["c1"]);
    expect(t.marked).toEqual([DEAL]);
  });

  it("sem mark_sent não mexe na etapa; a legenda padrão usa o nome e a rota", async () => {
    const t = setup();
    await handlePropostaSend(req(body()), t.deps);
    expect(t.marked).toHaveLength(0);
    expect(t.inserted[0].content).toBe("Olá, Maria! Segue a proposta da Amitran Mudanças para a sua mudança de Santa Maria, BH para São Joaquim, BH. Qualquer dúvida é só me chamar!");
  });

  it("usa a legenda escolhida pelo vendedor", async () => {
    const t = setup();
    await handlePropostaSend(req(body({ caption: "Oi! Proposta em anexo." })), t.deps);
    expect(t.inserted[0].content).toBe("Oi! Proposta em anexo.");
  });

  it("janela de 24h fechada: 409 e o PDF nem é gerado", async () => {
    const t = setup({ conversation: { last_inbound_at: hoursAgo(30) } });
    const res = await handlePropostaSend(req(body({ mark_sent: true })), t.deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("janela_24h_fechada");
    expect(t.renderPdf).not.toHaveBeenCalled();
    expect(t.marked).toHaveLength(0);
  });

  it("lead sem conversa de WhatsApp: 409 (use o download)", async () => {
    const t = setup({ conversation: null });
    const res = await handlePropostaSend(req(body()), t.deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("sem_conversa");
    expect(t.renderPdf).not.toHaveBeenCalled();
  });

  it("outro vendedor, negócio inexistente, conversa de outro vendedor => 404; sem login => 401", async () => {
    expect((await handlePropostaSend(req(body()), setup({ user: OTHER, dealOwner: SELLER.id }).deps)).status).toBe(404);
    expect((await handlePropostaSend(req(body()), setup({ deal: false }).deps)).status).toBe(404);
    expect((await handlePropostaSend(req(body()), setup({ conversation: { assigned_seller_id: OTHER.id } }).deps)).status).toBe(404);
    const t = setup();
    expect((await handlePropostaSend(req(body(), null), t.deps)).status).toBe(401);
    expect((await handlePropostaSend(req(body(), "Bearer falso"), t.deps)).status).toBe(401);
    expect((await handlePropostaSend(req({}, null), t.deps)).status).toBe(401); // sem login: nem olha o corpo
    expect((await handlePropostaPdf(req({}, null), t.deps)).status).toBe(401);
    expect(t.renderPdf).not.toHaveBeenCalled();
    expect(t.sendMedia).not.toHaveBeenCalled();
  });

  it("Head envia em qualquer negócio", async () => {
    const t = setup({ user: HEAD, dealOwner: OTHER.id, conversation: { assigned_seller_id: null } });
    expect((await handlePropostaSend(req(body()), t.deps)).status).toBe(200);
  });

  it("dados inválidos => 400 (campo enorme, número ruim, id errado, JSON quebrado)", async () => {
    const t = setup();
    for (const bad of [
      { deal_id: "x", form },
      { deal_id: DEAL, form: { ...form, observacoes: "x".repeat(2001) } },
      { deal_id: DEAL, form: { ...form, valorMudanca: "caro" } },
      { deal_id: DEAL, form: { ...form, valorMudanca: -5 } },
      { deal_id: DEAL },
      "{quebrado",
    ]) {
      expect((await handlePropostaSend(req(bad), t.deps)).status).toBe(400);
    }
    expect(t.renderPdf).not.toHaveBeenCalled();
  });

  it("falha ao gerar o PDF: 502, nada é enviado e a etapa não muda", async () => {
    const t = setup({ render: async () => { throw new Error("chromium caiu"); } });
    const res = await handlePropostaSend(req(body({ mark_sent: true })), t.deps);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("pdf_falhou");
    expect(t.upload).not.toHaveBeenCalled();
    expect(t.marked).toHaveLength(0);
  });

  it("falha do WhatsApp: 502, a tentativa fica registrada e a etapa NÃO muda", async () => {
    const t = setup();
    t.deps.sendMedia = async () => ({ ok: false, error: "131047 · fora da janela" });
    const res = await handlePropostaSend(req(body({ mark_sent: true })), t.deps);
    expect(res.status).toBe(502);
    expect(t.inserted[0]).toMatchObject({ status: "failed", type: "document" });
    expect(t.marked).toHaveLength(0);
  });
});

describe("handlePropostaPdf (baixar)", () => {
  it("devolve o PDF para download, com o nome do cliente", async () => {
    const t = setup();
    const res = await handlePropostaPdf(req({ deal_id: DEAL, form }), t.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).toContain("Proposta Amitran - Maria Souza.pdf");
    expect(await res.text()).toBe("%PDF-1.7 conteudo");
    expect(t.sendMedia).not.toHaveBeenCalled(); // baixar nunca envia nada ao cliente
  });

  it("exige login e acesso ao negócio; falha de geração => 502", async () => {
    expect((await handlePropostaPdf(req({ deal_id: DEAL, form }, null), setup().deps)).status).toBe(401);
    expect((await handlePropostaPdf(req({ deal_id: DEAL, form }), setup({ user: OTHER }).deps)).status).toBe(404);
    const broken = setup({ render: async () => { throw new Error("x"); } });
    expect((await handlePropostaPdf(req({ deal_id: DEAL, form }), broken.deps)).status).toBe(502);
  });
});

describe("nome do arquivo e legenda", () => {
  it("limpa caracteres estranhos do nome", () => {
    expect(proposalFilename("Maria/Souza <script>")).toBe("Proposta Amitran - MariaSouza script.pdf");
    expect(proposalFilename("")).toBe("Proposta Amitran - cliente.pdf");
  });
  it("legenda sem nome ou rota continua educada", () => {
    expect(defaultCaption({ ...form, nomeCliente: "", origem: "", destino: "" })).toBe("Olá! Segue a proposta da Amitran Mudanças para a sua mudança. Qualquer dúvida é só me chamar!");
  });
});
