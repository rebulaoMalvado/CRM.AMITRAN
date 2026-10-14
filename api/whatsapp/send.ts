import { handleSend } from "../../server/send-handler.js";
import { createAdminClient, createAuthenticator, createSendStore } from "../../server/supabase-store.js";

// Endereço: POST <endereço do CRM da Amitran>/api/whatsapp/send
// Chamado pelo CRM (frontend) com o token de login do usuário no cabeçalho Authorization.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    return await handleSend(request, {
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
    console.error("[whatsapp/send] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno ao enviar." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
