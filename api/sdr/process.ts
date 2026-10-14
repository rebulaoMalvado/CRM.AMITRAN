import { handleProcess } from "../../server/sdr/process-handler.js";
import { processConversation } from "../../server/sdr/engine.js";
import { createAnthropicProvider } from "../../server/sdr/llm.js";
import { sendWhatsappTemplate, sendWhatsappText } from "../../server/whatsapp-send.js";
import { notifySellerDetailed, parseSellerPhones } from "../../server/sdr/notify.js";
import { phoneKey } from "../../server/phone.js";
import { createAdminClient, createNotifyStore, createSdrStore } from "../../server/supabase-store.js";
import { crmBaseUrl, parseSellerPool } from "../../server/company.js";

// POST /api/sdr/process — roda a IA numa conversa. Só o nosso webhook chama (segredo interno).

const DEBOUNCE_MS = 6_000;

/**
 * Números liberados para resposta AUTOMÁTICA (SDR_AUTO_ALLOWLIST, separados por vírgula).
 * Vazio = ninguém; "*" = todos (só use quando o Lucas decidir abrir para todos).
 */
function readAutoAllowlist(): string[] | null {
  const raw = (process.env.SDR_AUTO_ALLOWLIST ?? "").trim();
  if (raw === "*") return null;
  return raw.split(",").map((n) => phoneKey(n)).filter(Boolean);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const db = createAdminClient();
    return await handleProcess(request, {
      secret: process.env.SDR_INTERNAL_SECRET,
      debounceMs: DEBOUNCE_MS,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      run: async (conversationId) => {
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");
        const whatsapp = {
          accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
          apiVersion: process.env.WHATSAPP_API_VERSION,
          apiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
        };
        return processConversation(
          {
            store: createSdrStore(db, { sellerPoolIds: parseSellerPool(process.env.SDR_SELLER_POOL) }),
            llm: createAnthropicProvider({ apiKey, model: process.env.SDR_MODEL || "claude-sonnet-5-5" }),
            // Trava extra: o envio automático só existe se SDR_ALLOW_AUTO=true (hoje NÃO está).
            allowAuto: process.env.SDR_ALLOW_AUTO === "true",
            autoAllowlist: readAutoAllowlist(),
            dailyLimit: Number(process.env.SDR_DAILY_LIMIT) || 300,
            // Cria o negócio no funil quando o lead fica qualificado (desligue com SDR_CREATE_DEALS=false).
            createDeals: process.env.SDR_CREATE_DEALS !== "false",
            send: (conversation, text) => sendWhatsappText(whatsapp, { to: conversation.wa_id, body: text }),
            // Lead qualificado novo vai para um vendedor, em revezamento (desligue com SDR_AUTO_ASSIGN=false).
            autoAssign: process.env.SDR_AUTO_ASSIGN !== "false",
            // Avisa o vendedor no WhatsApp (SELLER_NOTIFY_PHONES: "id-do-vendedor=telefone,..."; sem isso, não avisa).
            notifySeller: async (lead) => {
              const result = await notifySellerDetailed(
                {
                  phones: parseSellerPhones(process.env.SELLER_NOTIFY_PHONES),
                  crmUrl: crmBaseUrl(request.url),
                  templateName: process.env.SELLER_NOTIFY_TEMPLATE || undefined,
                  templateLanguage: process.env.SELLER_NOTIFY_TEMPLATE_LANG || undefined,
                  findSellerConversation: createNotifyStore(db).findSellerConversation,
                  sendText: (to, body) => sendWhatsappText(whatsapp, { to, body }),
                  sendTemplate: (to, name, language, bodyParams) => sendWhatsappTemplate(whatsapp, { to, name, language, bodyParams }),
                },
                lead.sellerId,
                lead,
              );
              // Sem nome nem telefone do cliente no log.
              console.log(`[sdr] aviso ao vendedor: ${result.outcome}${result.error ? ` — ${result.error}` : ""} (conversa ${lead.conversationId})`);
              return result;
            },
          },
          conversationId,
        );
      },
    });
  } catch (err) {
    console.error("[sdr/process] erro:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "erro_interno" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
