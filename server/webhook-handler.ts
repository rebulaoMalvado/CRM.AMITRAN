import { safeEqualText, verifySignature } from "./signature.js";
import { applyStatusUpdate, ingestInboundMessage, ingestOutboundEcho, type InboundStore } from "./ingest.js";
import { parseWebhookPayload } from "./whatsapp-parse.js";

export interface WebhookEnv {
  /**
   * "App Secret" do app da Meta — usado para validar a assinatura.
   * Pode ter MAIS DE UMA chave separadas por vírgula (ex.: a do nosso app e a do parceiro
   * que entrega as mensagens, como o Dualhook). Basta uma bater.
   */
  appSecret?: string;
  /** Texto que NÓS inventamos; a Meta devolve na verificação inicial do webhook. */
  verifyToken?: string;
}

// Pedaços de histórico do Coexistence podem ser grandes; o limite da Vercel é ~4,5 MB.
const MAX_BODY_BYTES = 4_000_000;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * GET: a Meta chama uma vez, ao cadastrar o webhook, para confirmar que a URL é nossa.
 * Se o token bater, devolvemos o "desafio" que ela mandou.
 */
export function handleVerification(request: Request, env: WebhookEnv): Response {
  if (!env.verifyToken) return text("Webhook não configurado", 500);

  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token && challenge && safeEqualText(token, env.verifyToken)) {
    return text(challenge, 200);
  }
  return text("Forbidden", 403);
}

/**
 * POST: a Meta avisa de mensagens novas. Regras:
 *  1. Sem assinatura válida => 401 e NADA é processado.
 *  2. Só grava no banco (mensagens e status de entrega) e responde rápido.
 *     NUNCA chama IA nem envia mensagem aqui dentro.
 *  3. Erro ao gravar => 500, a Meta reenvia e a idempotência evita duplicar.
 */
export async function handleIncoming(
  request: Request,
  deps: {
    env: WebhookEnv;
    getStore: () => InboundStore;
    /**
     * Chamado DEPOIS de gravar, com as conversas que receberam mensagem NOVA do cliente.
     * Serve só para avisar (em segundo plano) quem processa a IA — nunca roda a IA aqui dentro.
     */
    onInboundStored?: (conversationIds: string[]) => void;
  },
): Promise<Response> {
  const { env } = deps;
  // Sem segredo configurado, recusamos tudo (nunca aceitar mensagem sem poder validar).
  if (!env.appSecret) return text("Webhook não configurado", 500);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return text("Payload muito grande", 413);

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > MAX_BODY_BYTES) return text("Payload muito grande", 413);

  const secrets = env.appSecret.split(",").map((k) => k.trim()).filter(Boolean);
  const signature = request.headers.get("x-hub-signature-256");
  if (secrets.length === 0 || !secrets.some((secret) => verifySignature(rawBody, signature, secret))) {
    // Log só do necessário para diagnosticar (nunca o conteúdo nem as chaves).
    console.error(
      `[whatsapp] assinatura inválida: cabecalho=${signature ? "presente" : "ausente"} chaves_configuradas=${secrets.length} bytes=${rawBody.length}`,
    );
    return text("Assinatura inválida", 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return text("JSON inválido", 400);
  }

  const { messages, echoes, statuses, skipped, statusCount } = parseWebhookPayload(json);
  if (skipped > 0) console.error(`[whatsapp] ${skipped} mensagem(ns) malformada(s) ignorada(s)`);

  if (messages.length > 0 || echoes.length > 0 || statuses.length > 0) {
    try {
      const store = deps.getStore();
      let stored = 0;
      const newConversationIds = new Set<string>();
      for (const message of messages) {
        const result = await ingestInboundMessage(store, message);
        if (result.stored) {
          stored += 1;
          newConversationIds.add(result.conversationId);
        }
      }
      let echoed = 0;
      for (const echo of echoes) {
        const result = await ingestOutboundEcho(store, echo);
        if (result.stored) echoed += 1;
      }
      let applied = 0;
      for (const update of statuses) {
        const result = await applyStatusUpdate(store, update);
        if (result.applied) applied += 1;
        // Status de mensagem que não é uma conversa nossa (ex.: aviso ao vendedor): só registra o tipo e o motivo.
        else console.log(`[whatsapp] status sem conversa: ${update.status}${update.errorText ? ` — ${update.errorText.slice(0, 200)}` : ""}`);
      }
      console.log(
        `[whatsapp] recebidas=${messages.length} novas=${stored} do_celular=${echoed} status=${statusCount} status_aplicados=${applied}`,
      );
      if (newConversationIds.size > 0 && deps.onInboundStored) {
        try {
          deps.onInboundStored([...newConversationIds]);
        } catch (err) {
          // Falha em AVISAR a IA nunca pode fazer a Meta reenviar a mensagem.
          console.error("[whatsapp] aviso à IA falhou:", err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      // Sem dados do cliente no log (só o motivo técnico).
      console.error("[whatsapp] falha ao gravar:", err instanceof Error ? err.message : err);
      return text("Erro ao gravar", 500);
    }
  }

  return text("ok", 200);
}
