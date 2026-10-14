import { handleSendMedia } from "../../server/send-media-handler.js";
import { createAdminClient, createAuthenticator, createSendStore } from "../../server/supabase-store.js";

// POST /api/whatsapp/send-media (multipart) — foto, vídeo, áudio ou documento (precisa de login).

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    return await handleSendMedia(request, {
      config: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        apiVersion: process.env.WHATSAPP_API_VERSION,
        apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
      },
      authenticate: createAuthenticator(db),
      store: createSendStore(db),
    });
  } catch (err) {
    console.error("[whatsapp/send-media] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno ao enviar o arquivo." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
