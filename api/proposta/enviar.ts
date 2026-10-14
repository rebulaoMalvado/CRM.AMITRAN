import { COMPANY } from "../../server/company.js";
import { handlePropostaSend } from "../../server/proposta-handler.js";
import { renderPropostaPdf } from "../../server/proposta-pdf.js";
import { createAdminClient, createAuthenticator, createPropostaStore, createSendStore } from "../../server/supabase-store.js";

// POST /api/proposta/enviar — gera o PDF da proposta e envia ao cliente pelo WhatsApp do lead.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    const templateUrl = `${new URL(request.url).origin}${COMPANY.proposalTemplatePath}`;
    return await handlePropostaSend(request, {
      config: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        apiVersion: process.env.WHATSAPP_API_VERSION,
        apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
      },
      authenticate: createAuthenticator(db),
      store: createSendStore(db),
      proposta: createPropostaStore(db),
      renderPdf: (form) => renderPropostaPdf(form, templateUrl),
    });
  } catch (err) {
    console.error("[proposta/enviar] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno ao enviar a proposta." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
