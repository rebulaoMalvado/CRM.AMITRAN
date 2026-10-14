import { handleConversationAi } from "../../server/sdr/admin-handlers.js";
import { createAdminClient, createAuthenticator, createSdrConversationStore } from "../../server/supabase-store.js";

// POST /api/sdr/conversation — liga/desliga a IA numa conversa (Head ou vendedor responsável).

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    return await handleConversationAi(request, {
      authenticate: createAuthenticator(db),
      store: createSdrConversationStore(db),
    });
  } catch (err) {
    console.error("[sdr/conversation] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
