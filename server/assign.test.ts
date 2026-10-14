import { describe, expect, it, vi } from "vitest";
import { handleAssign, type AssignStore } from "./assign-handler.js";
import type { AuthUser } from "./send-handler.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const CONV = "11111111-1111-4111-8111-111111111111";
const SELLER_ID = "22222222-2222-4222-8222-222222222222";

function setup(user: AuthUser | null = HEAD, opts: { conversation?: boolean; targetRole?: "head" | "vendedor" | null } = {}) {
  const assigned: Array<[string, string | null]> = [];
  const store: AssignStore = {
    getProfileRole: async () => (opts.targetRole === undefined ? "vendedor" : opts.targetRole),
    conversationExists: async () => opts.conversation ?? true,
    setAssignedSeller: async (c, s) => void assigned.push([c, s]),
  };
  const deps = { authenticate: async (jwt: string) => (jwt === "ok" ? user : null), store };
  return { deps, assigned };
}

const req = (body: unknown, auth: string | null = "Bearer ok") =>
  new Request("https://x/api/whatsapp/assign", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("handleAssign", () => {
  it("Head passa a conversa para um vendedor e também pode tirar o dono (null)", async () => {
    const t = setup();
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: SELLER_ID }), t.deps)).status).toBe(200);
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: null }), t.deps)).status).toBe(200);
    expect(t.assigned).toEqual([[CONV, SELLER_ID], [CONV, null]]);
  });

  it("vendedor NÃO distribui conversa (403) e nada é gravado", async () => {
    const t = setup(SELLER);
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: SELLER_ID }), t.deps)).status).toBe(403);
    expect(t.assigned).toHaveLength(0);
  });

  it("sem login ou login inválido => 401", async () => {
    const t = setup();
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: null }, null), t.deps)).status).toBe(401);
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: null }, "Bearer falso"), t.deps)).status).toBe(401);
    expect(t.assigned).toHaveLength(0);
  });

  it("dados inválidos => 400; conversa ou vendedor inexistente => 404", async () => {
    const t = setup();
    expect((await handleAssign(req({ conversation_id: "x", seller_id: null }), t.deps)).status).toBe(400);
    expect((await handleAssign(req({ conversation_id: CONV }), t.deps)).status).toBe(400);
    expect((await handleAssign(req("{quebrado"), t.deps)).status).toBe(400);
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: SELLER_ID }), setup(HEAD, { conversation: false }).deps)).status).toBe(404);
    expect((await handleAssign(req({ conversation_id: CONV, seller_id: SELLER_ID }), setup(HEAD, { targetRole: null }).deps)).status).toBe(404);
    expect(t.assigned).toHaveLength(0);
  });
});
