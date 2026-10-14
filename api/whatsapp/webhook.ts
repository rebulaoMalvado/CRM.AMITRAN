import { handleIncoming, handleVerification, type WebhookEnv } from "../../server/webhook-handler.js";
import { createAdminClient, createSupabaseStore } from "../../server/supabase-store.js";
import { parseSellerPhones } from "../../server/sdr/notify.js";
import { waitUntil } from "@vercel/functions";

// Endereço público: <endereço do CRM da Amitran>/api/whatsapp/webhook
// É este o endereço que será cadastrado na Meta (Callback URL).

// Chaves de assinatura aceitas: a do nosso app da Meta e, opcionalmente, a do parceiro que
// entrega as mensagens (ex.: Dualhook). Basta UMA bater com a assinatura da mensagem.
const readEnv = (): WebhookEnv => ({
  appSecret: [process.env.WHATSAPP_APP_SECRET, process.env.WHATSAPP_APP_SECRET_PARTNER]
    .filter(Boolean)
    .join(","),
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
});

export async function GET(request: Request): Promise<Response> {
  return handleVerification(request, readEnv());
}

/**
 * Avisa — em SEGUNDO PLANO e numa execução separada — que chegou mensagem nova, para a IA
 * processar. O webhook em si nunca chama a IA: ele só grava e responde "ok" rápido.
 */
function notifySdr(requestUrl: string, conversationIds: string[]) {
  const secret = process.env.SDR_INTERNAL_SECRET;
  if (!secret) return; // sem o segredo interno configurado, a IA não é acionada
  const origin = new URL(requestUrl).origin;
  waitUntil(
    Promise.all(
      conversationIds.map((id) =>
        fetch(`${origin}/api/sdr/process`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-internal-secret": secret },
          body: JSON.stringify({ conversation_id: id }),
        }).catch((err) => console.error("[whatsapp] não consegui acionar a IA:", err instanceof Error ? err.message : err)),
      ),
    ),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleIncoming(request, {
    env: readEnv(),
    // Conversas dos vendedores nascem com a IA desligada (a Carol não atende a equipe).
    getStore: () => createSupabaseStore(createAdminClient(), { aiOffPhoneKeys: Object.values(parseSellerPhones(process.env.SELLER_NOTIFY_PHONES)) }),
    onInboundStored: (ids) => notifySdr(request.url, ids),
  });
}
