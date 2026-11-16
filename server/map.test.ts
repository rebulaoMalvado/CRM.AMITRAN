import { describe, expect, it, vi } from "vitest";
import { handleMapDeals, type MapDealRow, type MapStore } from "./map-handler.js";

const row: MapDealRow = {
  id: "d1", nome: "Maria", origem: "Belo Horizonte", destino: "Curitiba", dataMudanca: "2026-12-10",
  stage: "fechado", valor: 5000, sellerName: "Gabriel Gonçalves",
};

const store = (): MapStore => ({ listForMap: vi.fn(async () => ({ deals: [row], lost: 7 })) });
const req = (headers: Record<string, string> = {}) => new Request("https://crm.test/api/whatsapp/assign?op=mapa", { method: "POST", headers });

describe("handleMapDeals", () => {
  it("sem login: 401 e não lê o banco", async () => {
    const s = store();
    const res = await handleMapDeals(req(), { authenticate: async () => ({ id: "u", role: "vendedor" }), store: s });
    expect(res.status).toBe(401);
    expect(s.listForMap).not.toHaveBeenCalled();
  });

  it("sessão inválida: 401", async () => {
    const s = store();
    const res = await handleMapDeals(req({ authorization: "Bearer x" }), { authenticate: async () => null, store: s });
    expect(res.status).toBe(401);
    expect(s.listForMap).not.toHaveBeenCalled();
  });

  it("vendedor logado vê os negócios de todos, sem campos sensíveis", async () => {
    const res = await handleMapDeals(req({ authorization: "Bearer jwt" }), { authenticate: async () => ({ id: "u", role: "vendedor" }), store: store() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, deals: [row], lost: 7 });
    const keys = Object.keys(body.deals[0]);
    for (const forbidden of ["telefone", "parceiro", "motivo_perda", "seller_id"]) expect(keys).not.toContain(forbidden);
  });
});
