import { COMPANY } from "../../server/company.js";
import { handlePropostaPdf } from "../../server/proposta-handler.js";
import { renderPropostaPdf } from "../../server/proposta-pdf.js";
import { createAdminClient, createAuthenticator, createPropostaStore, createSendStore } from "../../server/supabase-store.js";

// POST /api/proposta/pdf — gera o PDF da proposta no servidor (Chromium) e devolve para baixar.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();
    const templateUrl = `${new URL(request.url).origin}${COMPANY.proposalTemplatePath}`;
    return await handlePropostaPdf(request, {
      config: {},
      authenticate: createAuthenticator(db),
      store: createSendStore(db),
      proposta: createPropostaStore(db),
      renderPdf: (form) => renderPropostaPdf(form, templateUrl),
    });
  } catch (err) {
    console.error("[proposta/pdf] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno ao gerar a proposta." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
