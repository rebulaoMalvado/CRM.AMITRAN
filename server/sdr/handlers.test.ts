import { describe, expect, it, vi } from "vitest";
import { handleConversationAi, handleSdrConfig, handleTestNotify } from "./admin-handlers.js";
import { handleProcess } from "./process-handler.js";
import type { AuthUser } from "../send-handler.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const OTHER: AuthUser = { id: "u-other", role: "vendedor" };
const CONV = "11111111-1111-4111-8111-111111111111";

const req = (body: unknown, auth: string | null = "Bearer ok", extra: Record<string, string> = {}) =>
  new Request("https://x/api/sdr", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}), ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("handleSdrConfig (interruptor geral)", () => {
  const setup = (user: AuthUser | null = HEAD, allowAuto = false) => {
    const updates: unknown[] = [];
    return {
      updates,
      deps: {
        authenticate: async (jwt: string) => (jwt === "ok" ? user : null),
        store: { updateConfig: async (u: unknown) => void updates.push(u) },
        allowAuto,
      },
    };
  };

  it("Head liga e desliga a IA e escolhe o modo sombra", async () => {
    const t = setup();
    expect((await handleSdrConfig(req({ ai_enabled: true }), t.deps)).status).toBe(200);
    expect((await handleSdrConfig(req({ ai_enabled: false, mode: "shadow" }), t.deps)).status).toBe(200);
    expect(t.updates).toEqual([
      { aiEnabled: true, mode: undefined, updatedBy: "u-head" },
      { aiEnabled: false, mode: "shadow", updatedBy: "u-head" },
    ]);
  });

  it("vendedor não mexe no interruptor geral (403); sem login (401)", async () => {
    const t = setup(SELLER);
    expect((await handleSdrConfig(req({ ai_enabled: true }), t.deps)).status).toBe(403);
    expect((await handleSdrConfig(req({ ai_enabled: true }, null), t.deps)).status).toBe(401);
    expect((await handleSdrConfig(req({ ai_enabled: true }, "Bearer falso"), t.deps)).status).toBe(401);
    expect(t.updates).toHaveLength(0);
  });

  it("modo automático é bloqueado enquanto a trava não for liberada", async () => {
    const blocked = setup(HEAD, false);
    const res = await handleSdrConfig(req({ mode: "auto" }), blocked.deps);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("modo_automatico_bloqueado");
    expect(blocked.updates).toHaveLength(0);

    const open = setup(HEAD, true);
    expect((await handleSdrConfig(req({ mode: "auto" }), open.deps)).status).toBe(200);
  });

  it("dados inválidos => 400", async () => {
    const t = setup();
    for (const body of [{}, { mode: "outro" }, { ai_enabled: "sim" }, "{quebrado"]) {
      expect((await handleSdrConfig(req(body), t.deps)).status).toBe(400);
    }
  });
});

describe("handleConversationAi (interruptor da conversa)", () => {
  const setup = (user: AuthUser | null, assigned: string | null = SELLER.id, exists = true) => {
    const calls: Array<[string, boolean]> = [];
    return {
      calls,
      deps: {
        authenticate: async (jwt: string) => (jwt === "ok" ? user : null),
        store: {
          getAccess: async () => (exists ? { id: CONV, assigned_seller_id: assigned } : null),
          setConversationAi: async (id: string, on: boolean) => void calls.push([id, on]),
        },
      },
    };
  };

  it("Head e o vendedor responsável ligam/desligam; outro vendedor não", async () => {
    const head = setup(HEAD);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }), head.deps)).status).toBe(200);
    const owner = setup(SELLER);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: false }), owner.deps)).status).toBe(200);
    expect(owner.calls).toEqual([[CONV, false]]);

    const other = setup(OTHER);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }), other.deps)).status).toBe(404);
    expect(other.calls).toHaveLength(0);
  });

  it("sem dono: só o Head; conversa inexistente: 404; sem login: 401; dados ruins: 400", async () => {
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }), setup(SELLER, null).deps)).status).toBe(404);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }), setup(HEAD, null).deps)).status).toBe(200);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }), setup(HEAD, null, false).deps)).status).toBe(404);
    expect((await handleConversationAi(req({ conversation_id: CONV, ai_enabled: true }, null), setup(HEAD).deps)).status).toBe(401);
    expect((await handleConversationAi(req({ conversation_id: "x", ai_enabled: true }), setup(HEAD).deps)).status).toBe(400);
  });
});

describe("handleProcess (execução interna da IA)", () => {
  const make = (secret: string | null = "segredo") => {
    const run = vi.fn(async () => "draft_saved" as const);
    const sleep = vi.fn(async () => {});
    return { run, sleep, deps: { secret: secret ?? undefined, run, sleep, debounceMs: 6000 } };
  };
  const call = (deps: ReturnType<typeof make>["deps"], headers: Record<string, string>, body: unknown = { conversation_id: CONV }) =>
    handleProcess(req(body, null, headers), deps);

  it("com o segredo certo: espera o tempo de agrupar e roda a IA", async () => {
    const t = make();
    const res = await call(t.deps, { "x-internal-secret": "segredo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "draft_saved" });
    expect(t.sleep).toHaveBeenCalledWith(6000);
    expect(t.run).toHaveBeenCalledWith(CONV);
  });

  it("sem segredo, segredo errado ou não configurado: não roda a IA", async () => {
    const t = make();
    expect((await call(t.deps, {})).status).toBe(401);
    expect((await call(t.deps, { "x-internal-secret": "errado" })).status).toBe(401);
    expect((await call(make(null).deps, { "x-internal-secret": "segredo" })).status).toBe(500);
    expect(t.run).not.toHaveBeenCalled();
  });

  it("corpo inválido => 400", async () => {
    const t = make();
    expect((await call(t.deps, { "x-internal-secret": "segredo" }, { conversation_id: "x" })).status).toBe(400);
    expect(t.run).not.toHaveBeenCalled();
  });
});

describe("handleTestNotify (teste do aviso ao vendedor)", () => {
  const SID = "22222222-2222-4222-8222-222222222222";
  const make = (user: AuthUser | null, outcome = "sent_template", error?: string) => {
    const notify = vi.fn(async () => ({ outcome, error }));
    return { notify, deps: { authenticate: async () => user, notify } };
  };

  it("sem login: 401 e nada é enviado", async () => {
    const t = make(HEAD);
    expect((await handleTestNotify(req({ seller_id: SID }, null), t.deps)).status).toBe(401);
    expect(t.notify).not.toHaveBeenCalled();
  });
  it("vendedor não pode: 403", async () => {
    const t = make(SELLER);
    expect((await handleTestNotify(req({ seller_id: SID }), t.deps)).status).toBe(403);
    expect(t.notify).not.toHaveBeenCalled();
  });
  it("corpo inválido: 400", async () => {
    const t = make(HEAD);
    expect((await handleTestNotify(req({ seller_id: "x" }), t.deps)).status).toBe(400);
  });
  it("Head: manda e devolve o resultado, com o motivo quando falha", async () => {
    const ok = make(HEAD, "sent_template");
    const r1 = await handleTestNotify(req({ seller_id: SID }), ok.deps);
    expect(await r1.json()).toEqual({ ok: true, outcome: "sent_template", error: null });
    const bad = make(HEAD, "failed", "131042 · pagamento");
    const r2 = await handleTestNotify(req({ seller_id: SID }), bad.deps);
    expect(await r2.json()).toEqual({ ok: false, outcome: "failed", error: "131042 · pagamento" });
  });
});
