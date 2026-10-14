import { COMPANY } from "../../server/company.js";
import { handlePropostaSend } from "../../server/proposta-handler.js";
import { renderProposta } from "../../server/proposta-pdf.js";
import { createAdminClient, createAuthenticator, createPropostaStore, createSendStore } from "../../server/supabase-store.js";

// POST /api/proposta/enviar — gera o PDF da proposta e envia ao cliente pelo WhatsApp do lead.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    const templateUrl = `${new URL(request.url).origin}${COMPANY.proposalTemplatePath}`;
    // O mesmo navegador gera o PDF e fotografa a capa: abre uma vez só e as duas partes reaproveitam o resultado.
    let rendered: ReturnType<typeof renderProposta> | null = null;
    const render = (form: Parameters<typeof renderProposta>[0]) => (rendered ??= renderProposta(form, templateUrl, { withCover: true }));
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
      renderPdf: async (form) => (await render(form)).pdf,
      renderCover: async (form) => (await render(form)).cover,
    });
  } catch (err) {
    console.error("[proposta/enviar] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno ao enviar a proposta." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
