import { handleAssign } from "../../server/assign-handler.js";
import { handleCreateLead } from "../../server/create-lead-handler.js";
import { handleMapDeals } from "../../server/map-handler.js";
import { createAdminClient, createAssignStore, createAuthenticator, createMapStore, createSdrStore } from "../../server/supabase-store.js";

// POST /api/whatsapp/assign                    — o Head passa a conversa para um vendedor (somente Head).
// POST /api/whatsapp/assign?op=create-lead     — a equipe gera o lead no funil a partir da conversa.
// POST /api/whatsapp/assign?op=mapa            — Mapa de rotas: negócios de todos os vendedores (só leitura).
//
// Duas ações no mesmo arquivo de propósito: o plano atual da Vercel aceita no máximo 12 funções.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    const op = new URL(request.url).searchParams.get("op");
    if (op === "create-lead") {
      return await handleCreateLead(request, { authenticate: createAuthenticator(db), store: createSdrStore(db) });
    }
    if (op === "mapa") {
      return await handleMapDeals(request, { authenticate: createAuthenticator(db), store: createMapStore(db) });
    }
    return await handleAssign(request, {
      authenticate: createAuthenticator(db),
      store: createAssignStore(db),
    });
  } catch (err) {
    console.error("[whatsapp/assign] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
