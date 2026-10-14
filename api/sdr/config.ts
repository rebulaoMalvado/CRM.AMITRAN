import { handleSdrConfig, handleSimulate, handleTestNotify } from "../../server/sdr/admin-handlers.js";
import { createAnthropicProvider } from "../../server/sdr/llm.js";
import { simulateTurn } from "../../server/sdr/simulate.js";
import { notifySellerDetailed, parseSellerPhones } from "../../server/sdr/notify.js";
import { sendWhatsappTemplate, sendWhatsappText } from "../../server/whatsapp-send.js";
import { createAdminClient, createAuthenticator, createNotifyStore, createSdrConfigStore } from "../../server/supabase-store.js";
import { crmBaseUrl } from "../../server/company.js";

// POST /api/sdr/config                   — liga/desliga a IA para todo o CRM e escolhe o modo (somente Head).
// POST /api/sdr/config?op=test-notify    — manda um aviso de MENTIRA ao vendedor, igual ao da assistente (Carol), e devolve
//                                          o resultado (inclusive o motivo se a Meta recusar). Somente Head.
//
// POST /api/sdr/config?op=simulate       — simulador: roda UMA rodada da Carol sem gravar nada nem mandar WhatsApp. Somente Head.
//
// Várias ações no mesmo arquivo de propósito: o plano atual da Vercel aceita no máximo 12 funções.

export async function POST(request: Request): Promise<Response> {
  try {
    const db = createAdminClient();

    if (new URL(request.url).searchParams.get("op") === "test-notify") {
      const whatsapp = {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        apiVersion: process.env.WHATSAPP_API_VERSION,
        apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
      };
      return await handleTestNotify(request, {
        authenticate: createAuthenticator(db),
        notify: (sellerId) =>
          notifySellerDetailed(
            {
              phones: parseSellerPhones(process.env.SELLER_NOTIFY_PHONES),
              crmUrl: crmBaseUrl(request.url),
              templateName: process.env.SELLER_NOTIFY_TEMPLATE || undefined,
              templateLanguage: process.env.SELLER_NOTIFY_TEMPLATE_LANG || undefined,
              findSellerConversation: createNotifyStore(db).findSellerConversation,
              sendText: (to, body) => sendWhatsappText(whatsapp, { to, body }),
              sendTemplate: (to, name, language, bodyParams) => sendWhatsappTemplate(whatsapp, { to, name, language, bodyParams }),
            },
            sellerId,
            {
              conversationId: "teste",
              nome: "Maria Teste (teste)",
              origem: "Santa Maria, Belo Horizonte",
              destino: "Contagem",
              dataLabel: "15 de novembro (teste)",
            },
          ),
      });
    }

    if (new URL(request.url).searchParams.get("op") === "simulate") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      return await handleSimulate(request, {
        authenticate: createAuthenticator(db),
        run: (input) => {
          if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");
          return simulateTurn(createAnthropicProvider({ apiKey, model: process.env.SDR_MODEL || "claude-sonnet-5-5" }), input);
        },
      });
    }

    return await handleSdrConfig(request, {
      authenticate: createAuthenticator(db),
      store: createSdrConfigStore(db),
      allowAuto: process.env.SDR_ALLOW_AUTO === "true",
    });
  } catch (err) {
    console.error("[sdr/config] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno", message: "Erro interno." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
