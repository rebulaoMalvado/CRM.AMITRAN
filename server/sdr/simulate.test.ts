import { describe, expect, it, vi } from "vitest";
import { simulateTurn, type SimInput } from "./simulate.js";
import { PRICE_FALLBACK_REPLY } from "./engine.js";
import { handleSimulate } from "./admin-handlers.js";
import type { LlmProvider } from "./llm.js";
import type { AuthUser } from "../send-handler.js";

const EMPTY_Q = { nome: null, origem: null, destino: null, data_mudanca: null, data_iso: null, bens: null };
const result = (over: Record<string, unknown>, q: Record<string, unknown> = {}) => ({
  output: { reply: "Oi!", handoff: false, handoff_reason: null, qualification: { ...EMPTY_Q, ...q }, ...over },
  refusal: false,
  model: "claude-sonnet-5-5",
  usage: { inputTokens: 10, outputTokens: 5 },
});
const llmOf = (...results: ReturnType<typeof result>[]) => {
  const generate = vi.fn(async () => results.shift() as ReturnType<typeof result>);
  return { llm: { generate } as unknown as LlmProvider, generate };
};
const NOW = () => Date.parse("2026-10-07T21:30:00Z"); // quarta 18:30 BRT (fora do horário)
const customer = (content: string) => ({ from: "customer" as const, type: "text" as const, content });
const victoria = (content: string) => ({ from: "victoria" as const, type: "text" as const, content });
const photo = { from: "customer" as const, type: "image" as const, content: "" };

describe("simulateTurn", () => {
  it("devolve a resposta e junta os dados novos aos que já estavam anotados", async () => {
    const t = llmOf(result({ reply: "Prazer! E a data?" }, { origem: "Belo Horizonte", destino: "São Paulo" }));
    const r = await simulateTurn(t.llm, { messages: [customer("sou lucas, de bh para sp")], known: { nome: "Lucas" } }, NOW);
    expect(r.reply).toBe("Prazer! E a data?");
    expect(r.qualification).toEqual({ nome: "Lucas", origem: "Belo Horizonte", destino: "São Paulo" });
    expect(r.leadWouldBeCreated).toBe(false);
    expect(r.blockedByPriceFilter).toBe(false);
  });

  it("usa o mesmo prompt da conversa real (regras, hoje, fora do horário pelo relógio)", async () => {
    const t = llmOf(result({}));
    await simulateTurn(t.llm, { messages: [customer("oi")], known: {} }, NOW);
    const system = (t.generate.mock.calls[0] as unknown as [{ system: string }])[0].system;
    expect(system).toContain("REGRAS ABSOLUTAS");
    expect(system).toContain("HOJE É:");
    expect(system).toContain("FORA DO HORÁRIO COMERCIAL"); // quarta 18:30
  });

  it("dá para forçar horário comercial ou fora dele", async () => {
    const comercial = llmOf(result({}));
    await simulateTurn(comercial.llm, { messages: [customer("oi")], known: {}, afterHours: false }, NOW);
    expect((comercial.generate.mock.calls[0] as unknown as [{ system: string }])[0].system).not.toContain("FORA DO HORÁRIO COMERCIAL");
    const fora = llmOf(result({}));
    const r = await simulateTurn(fora.llm, { messages: [customer("oi")], known: {}, afterHours: true }, Date.parse.bind(null, "2026-10-07T15:00:00Z"));
    expect(r.businessHours).toBe(false);
  });

  it("dados completos + foto: avisa que o lead seria criado e a IA recebe a ordem de encerrar", async () => {
    const known = { nome: "Lucas", origem: "BH", destino: "SP", data_mudanca: "terça" };
    const t = llmOf(result({ reply: "Pronto!", handoff: true, handoff_reason: "Lead qualificado" }));
    const r = await simulateTurn(t.llm, { messages: [customer("oi"), victoria("Qual a data?"), customer("terça"), photo], known }, NOW);
    expect(r.leadWouldBeCreated).toBe(true);
    expect(r.handoff).toBe(true);
    expect((t.generate.mock.calls[0] as unknown as [{ system: string }])[0].system).toContain("DADOS COMPLETOS");
  });

  it("filtro de preço: troca a resposta pela mensagem fixa e marca como bloqueada", async () => {
    const t = llmOf(result({ reply: "O valor é 900 reais" }), result({ reply: "Sai por R$ 900" }));
    const r = await simulateTurn(t.llm, { messages: [customer("quanto fica?")], known: {} }, NOW);
    expect(t.generate).toHaveBeenCalledTimes(2); // uma nova tentativa antes de barrar
    expect(r.blockedByPriceFilter).toBe(true);
    expect(r.reply).toBe(PRICE_FALLBACK_REPLY);
    expect(r.handoff).toBe(true);
  });

  it("se a segunda tentativa vem limpa, o cliente vê a limpa", async () => {
    const t = llmOf(result({ reply: "Sobre o valor, é com o consultor." }), result({ reply: "O consultor monta o orçamento certinho e envia em seguida." }));
    const r = await simulateTurn(t.llm, { messages: [customer("quanto fica?")], known: {} }, NOW);
    expect(r.blockedByPriceFilter).toBe(false);
    expect(r.reply).toContain("monta o orçamento certinho");
  });

  it("resposta fora do formato: avisa e não anota nada novo", async () => {
    const t = llmOf({ output: "lixo" as unknown as never, refusal: false, model: "m", usage: { inputTokens: 1, outputTokens: 1 } } as never);
    const r = await simulateTurn(t.llm, { messages: [customer("oi")], known: { nome: "Lucas" } }, NOW);
    expect(r.reply).toBeNull();
    expect(r.handoffReason).toContain("fora do formato");
    expect(r.qualification).toEqual({ nome: "Lucas" });
  });
});

describe("handleSimulate", () => {
  const HEAD: AuthUser = { id: "u-head", role: "head" };
  const SELLER: AuthUser = { id: "u-s", role: "vendedor" };
  const req = (body: unknown, auth: string | null = "Bearer ok") =>
    new Request("https://x/api/sdr/config?op=simulate", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
  const valid = { messages: [{ from: "customer", type: "text", content: "oi" }], known: {} };
  const make = (user: AuthUser | null) => {
    const run = vi.fn(async (_i: SimInput) => ({ reply: "Oi!", handoff: false, handoffReason: null, qualification: {}, leadWouldBeCreated: false, blockedByPriceFilter: false, businessHours: true, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" }));
    return { run, deps: { authenticate: async () => user, run } };
  };

  it("sem login: 401; vendedor: 403 — e a IA nem é chamada", async () => {
    const a = make(HEAD);
    expect((await handleSimulate(req(valid, null), a.deps)).status).toBe(401);
    const b = make(SELLER);
    expect((await handleSimulate(req(valid), b.deps)).status).toBe(403);
    expect(a.run).not.toHaveBeenCalled();
    expect(b.run).not.toHaveBeenCalled();
  });

  it("corpo inválido ou última mensagem que não é do cliente: 400", async () => {
    const t = make(HEAD);
    expect((await handleSimulate(req({ messages: [] }), t.deps)).status).toBe(400);
    expect((await handleSimulate(req({ messages: [{ from: "victoria", type: "text", content: "oi" }] }), t.deps)).status).toBe(400);
    expect(t.run).not.toHaveBeenCalled();
  });

  it("Head: roda e devolve o resultado", async () => {
    const t = make(HEAD);
    const res = await handleSimulate(req({ ...valid, after_hours: true }), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reply: "Oi!" });
    expect(t.run.mock.calls[0][0].afterHours).toBe(true);
  });
});
