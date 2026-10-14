import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAssignStore, createPropostaStore, createSdrStore } from "./supabase-store.js";
import { crmBaseUrl, parseSellerPool } from "./company.js";

/**
 * Banco de mentira: cada consulta (`from(tabela)...`) devolve a próxima resposta da fila
 * daquela tabela e guarda o que foi pedido (filtros), para conferirmos as regras da Lixeira.
 */
interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}

function fakeDb(responses: Record<string, Array<{ data: unknown; error?: { message: string } | null }>>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const answer = () => {
        const next = responses[table]?.shift() ?? { data: null };
        return { data: next.data, error: next.error ?? null };
      };
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "update", "insert", "eq", "neq", "in", "not", "is", "or", "order", "limit"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => answer();
      chain.single = async () => answer();
      chain.then = (resolve: (v: unknown) => unknown) => resolve(answer());
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const hasOp = (call: Call, name: string, ...args: unknown[]) =>
  call.ops.some(([op, a]) => op === name && args.every((x, i) => a[i] === x));

describe("Lixeira (deals.deleted_at)", () => {
  it("findOpenDealByPhone só olha negócios que NÃO estão na Lixeira", async () => {
    const { db, calls } = fakeDb({ deals: [{ data: [{ id: "d1", telefone: "+55 31 98888-0001" }] }] });
    const id = await createSdrStore(db).findOpenDealByPhone("5531988880001");
    expect(id).toBe("d1");
    expect(hasOp(calls[0], "is", "deleted_at", null)).toBe(true);
    expect(calls[0].table).toBe("deals");
  });

  it("getConversation: negócio ligado que foi para a Lixeira conta como 'sem negócio'", async () => {
    const conv = { id: "c1", deal_id: "d1", status: "ai" };
    const trashed = fakeDb({ crm_conversations: [{ data: conv }], deals: [{ data: { deleted_at: "2026-10-01T00:00:00Z" } }] });
    expect((await createSdrStore(trashed.db).getConversation("c1"))?.deal_id).toBeNull();

    const alive = fakeDb({ crm_conversations: [{ data: conv }], deals: [{ data: { deleted_at: null } }] });
    expect((await createSdrStore(alive.db).getConversation("c1"))?.deal_id).toBe("d1");

    const missing = fakeDb({ crm_conversations: [{ data: conv }], deals: [{ data: null }] });
    expect((await createSdrStore(missing.db).getConversation("c1"))?.deal_id).toBeNull();
  });

  it("getConversation sem negócio ligado não consulta a tabela deals", async () => {
    const { db, calls } = fakeDb({ crm_conversations: [{ data: { id: "c1", deal_id: null } }] });
    await createSdrStore(db).getConversation("c1");
    expect(calls.map((c) => c.table)).toEqual(["crm_conversations"]);
  });

  it("fillDealGaps, getDealAccess e markProposalSent ignoram negócio da Lixeira", async () => {
    const a = fakeDb({ deals: [{ data: null }] });
    await createSdrStore(a.db).fillDealGaps("d1", { origem: "A", destino: "B", dataMudancaIso: "2026-12-01" });
    expect(hasOp(a.calls[0], "is", "deleted_at", null)).toBe(true);
    expect(a.calls).toHaveLength(1); // não tentou atualizar

    const b = fakeDb({ deals: [{ data: null }] });
    expect(await createPropostaStore(b.db).getDealAccess("d1")).toBeNull();
    expect(hasOp(b.calls[0], "is", "deleted_at", null)).toBe(true);

    const c = fakeDb({ deals: [{ data: null }] });
    await createPropostaStore(c.db).markProposalSent("d1");
    expect(hasOp(c.calls[0], "is", "deleted_at", null)).toBe(true);
  });

  it("trocar o responsável da conversa não mexe em negócio da Lixeira", async () => {
    const { db, calls } = fakeDb({
      crm_conversations: [{ data: null }, { data: { assigned_seller_id: "s1", deal_id: "d1" } }],
      deals: [{ data: null }],
    });
    await createAssignStore(db).setAssignedSeller("c1", "s1");
    const dealUpdate = calls.find((c) => c.table === "deals");
    expect(dealUpdate).toBeTruthy();
    expect(hasOp(dealUpdate as Call, "is", "deleted_at", null)).toBe(true);
  });
});

describe("revezamento só entre os vendedores da lista", () => {
  const sellers = (ids: string[]) => ({ data: ids.map((id) => ({ id })) });

  it("sem lista: ninguém é escolhido (o lead fica com o Head)", async () => {
    const { db, calls } = fakeDb({});
    expect(await createSdrStore(db).pickNextSeller()).toBeNull();
    expect(await createSdrStore(db, { sellerPoolIds: [] }).pickNextSeller()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("primeiro lead vai para o primeiro da lista; depois alterna", async () => {
    const pool = ["raufle", "gabriel"];
    const first = fakeDb({ profiles: [sellers(pool)], crm_conversations: [{ data: [] }] });
    expect(await createSdrStore(first.db, { sellerPoolIds: pool }).pickNextSeller()).toBe("raufle");

    const afterRaufle = fakeDb({
      profiles: [sellers(pool)],
      crm_conversations: [{ data: [{ deal_id: "d1" }] }],
      deals: [{ data: [{ seller_id: "raufle" }] }],
    });
    expect(await createSdrStore(afterRaufle.db, { sellerPoolIds: pool }).pickNextSeller()).toBe("gabriel");

    const afterGabriel = fakeDb({
      profiles: [sellers(pool)],
      crm_conversations: [{ data: [{ deal_id: "d2" }] }],
      deals: [{ data: [{ seller_id: "gabriel" }] }],
    });
    expect(await createSdrStore(afterGabriel.db, { sellerPoolIds: pool }).pickNextSeller()).toBe("raufle");
  });

  it("só considera quem é da lista E tem perfil de vendedor (o banco filtra por role e ids)", async () => {
    const { db, calls } = fakeDb({ profiles: [sellers(["gabriel"])] });
    const next = await createSdrStore(db, { sellerPoolIds: ["raufle", "gabriel"] }).pickNextSeller();
    expect(next).toBe("gabriel"); // raufle não voltou como vendedor válido
    expect(hasOp(calls[0], "eq", "role", "vendedor")).toBe(true);
    expect(hasOp(calls[0], "in", "id")).toBe(true);
  });
});

describe("company.ts", () => {
  it("parseSellerPool separa ids por vírgula e ignora vazios", () => {
    expect(parseSellerPool(" a , b,,c ")).toEqual(["a", "b", "c"]);
    expect(parseSellerPool(undefined)).toEqual([]);
    expect(parseSellerPool("")).toEqual([]);
  });

  it("crmBaseUrl usa CRM_PUBLIC_URL e, sem ela, o domínio da requisição", () => {
    expect(crmBaseUrl("https://crm.amitran.test/api/x", { CRM_PUBLIC_URL: "https://crm.exemplo.com/" } as NodeJS.ProcessEnv)).toBe("https://crm.exemplo.com");
    expect(crmBaseUrl("https://crm.amitran.test/api/x", {} as NodeJS.ProcessEnv)).toBe("https://crm.amitran.test");
  });
});
