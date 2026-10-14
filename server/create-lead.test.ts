import { describe, expect, it, vi } from "vitest";
import { handleCreateLead, type CreateLeadStore } from "./create-lead-handler.js";
import type { AuthUser } from "./send-handler.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const RAUFLE: AuthUser = { id: "u-raufle", role: "vendedor" };
const CONV = "11111111-1111-4111-8111-111111111111";

const req = (body: unknown, auth: string | null = "Bearer ok") =>
  new Request("https://x/api/whatsapp/create-lead", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
const valid = { conversation_id: CONV, nome: "Maria Souza", origem: "Santa Maria, BH", destino: "Contagem", data_mudanca: "2026-11-15" };

function make(opts: { user?: AuthUser | null; conversation?: Partial<Record<string, unknown>> | null; existingDeal?: string | null } = {}) {
  const calls = { created: [] as any[], linked: [] as any[], assigned: [] as any[], filled: [] as any[], synced: 0, handoffs: 0 };
  const conv =
    opts.conversation === null
      ? null
      : { id: CONV, wa_id: "553188880003", telefone_norm: "5531988880003", status: "ai", ai_enabled: true, assigned_seller_id: null, deal_id: null, qualification: null, ...opts.conversation };
  const store: CreateLeadStore = {
    getConversation: async () => conv as any,
    findOpenDealByPhone: async () => opts.existingDeal ?? null,
    createDeal: async (input) => {
      calls.created.push(input);
      return "deal-novo";
    },
    linkDeal: async (c, d) => void calls.linked.push([c, d]),
    fillDealGaps: async (d, data) => void calls.filled.push([d, data]),
    syncDealOwner: async () => void (calls.synced += 1),
    assignConversation: async (c, s) => void calls.assigned.push([c, s]),
    handoffToHuman: async () => void (calls.handoffs += 1),
  };
  const authenticate = vi.fn(async () => (opts.user === undefined ? HEAD : opts.user));
  return { deps: { authenticate, store }, calls, authenticate };
}

describe("handleCreateLead (botão Gerar lead)", () => {
  it("sem login: 401 e nada acontece", async () => {
    const t = make();
    expect((await handleCreateLead(req(valid, null), t.deps)).status).toBe(401);
    expect(t.authenticate).not.toHaveBeenCalled();
    expect(t.calls.created).toHaveLength(0);
  });

  it("sessão inválida: 401", async () => {
    const t = make({ user: null });
    expect((await handleCreateLead(req(valid), t.deps)).status).toBe(401);
  });

  it("falta nome, origem ou destino: 400", async () => {
    for (const missing of ["nome", "origem", "destino"] as const) {
      const t = make();
      expect((await handleCreateLead(req({ ...valid, [missing]: "  " }), t.deps)).status).toBe(400);
      expect(t.calls.created).toHaveLength(0);
    }
    const t = make();
    expect((await handleCreateLead(req({ ...valid, data_mudanca: "15/11" }), t.deps)).status).toBe(400);
  });

  it("conversa que não existe: 404", async () => {
    const t = make({ conversation: null });
    expect((await handleCreateLead(req(valid), t.deps)).status).toBe(404);
  });

  it("vendedor não mexe na conversa de outro vendedor: 403", async () => {
    const t = make({ user: RAUFLE, conversation: { assigned_seller_id: "u-gabriel" } });
    expect((await handleCreateLead(req(valid), t.deps)).status).toBe(403);
    expect(t.calls.created).toHaveLength(0);
  });

  it("conversa que já tem lead: 409, sem duplicar", async () => {
    const t = make({ conversation: { deal_id: "deal-antigo" } });
    expect((await handleCreateLead(req(valid), t.deps)).status).toBe(409);
    expect(t.calls.created).toHaveLength(0);
  });

  it("vendedor dono: cria lead com os dados, SEM valor e SEM tipo de serviço, e a Carol sai de cena", async () => {
    const t = make({ user: RAUFLE, conversation: { assigned_seller_id: "u-raufle" } });
    const res = await handleCreateLead(req(valid), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deal_id: "deal-novo", linked: false });
    expect(t.calls.created).toEqual([
      { conversationId: CONV, assignedSellerId: "u-raufle", nome: "Maria Souza", telefone: "+55 31 98888-0003", origem: "Santa Maria, BH", destino: "Contagem", dataMudancaIso: "2026-11-15" },
    ]);
    expect(Object.keys(t.calls.created[0])).not.toContain("valor");
    expect(t.calls.linked).toEqual([[CONV, "deal-novo"]]);
    expect(t.calls.synced).toBe(1);
    expect(t.calls.handoffs).toBe(1);
    expect(t.calls.assigned).toHaveLength(0);
  });

  it("vendedor numa conversa sem dono: a conversa passa a ser dele", async () => {
    const t = make({ user: RAUFLE });
    await handleCreateLead(req(valid), t.deps);
    expect(t.calls.assigned).toEqual([[CONV, "u-raufle"]]);
    expect(t.calls.created[0].assignedSellerId).toBe("u-raufle");
  });

  it("Head numa conversa sem dono: não distribui sozinho (o lead fica com o Head até ele escolher)", async () => {
    const t = make({ user: HEAD });
    await handleCreateLead(req(valid), t.deps);
    expect(t.calls.assigned).toHaveLength(0);
    expect(t.calls.created[0].assignedSellerId).toBeNull();
  });

  it("data é opcional", async () => {
    const t = make();
    await handleCreateLead(req({ ...valid, data_mudanca: null }), t.deps);
    expect(t.calls.created[0].dataMudancaIso).toBeNull();
  });

  it("cliente com negócio aberto: só liga, não cria outro", async () => {
    const t = make({ existingDeal: "deal-aberto" });
    const res = await handleCreateLead(req(valid), t.deps);
    expect(await res.json()).toEqual({ ok: true, deal_id: "deal-aberto", linked: true });
    expect(t.calls.created).toHaveLength(0);
    expect(t.calls.linked).toEqual([[CONV, "deal-aberto"]]);
    expect(t.calls.filled).toEqual([["deal-aberto", { origem: "Santa Maria, BH", destino: "Contagem", dataMudancaIso: "2026-11-15" }]]);
  });
});
