import { handleMedia } from "../../server/media-handler.js";
import { createAdminClient, createAuthenticator, createMediaStore } from "../../server/supabase-store.js";

// GET /api/whatsapp/media?message=<id> — foto/vídeo/áudio/documento de uma mensagem (precisa de login).

export async function GET(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    return await handleMedia(request, {
      config: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        apiVersion: process.env.WHATSAPP_API_VERSION,
        apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
      },
      authenticate: createAuthenticator(db),
      store: createMediaStore(db),
    });
  } catch (err) {
    console.error("[whatsapp/media] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
