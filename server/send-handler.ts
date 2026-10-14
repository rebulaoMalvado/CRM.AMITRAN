import { z } from "zod";
import { sendWhatsappText, type SendResult, type WhatsappConfig } from "./whatsapp-send.js";

/** Usuário já autenticado (vem do login do CRM). */
export interface AuthUser {
  id: string;
  role: "head" | "vendedor";
}

export interface ConversationRow {
  id: string;
  wa_id: string;
  /** Número normalizado (no Brasil, com o 9º dígito). Usado como 2ª tentativa de envio. */
  telefone_norm?: string | null;
  assigned_seller_id: string | null;
  last_inbound_at: string | null;
}

/** O que o envio precisa do banco (versão real em supabase-store.ts). */
export interface SendStore {
  getConversation(id: string): Promise<ConversationRow | null>;
  insertOutboundMessage(input: {
    conversationId: string;
    userId: string;
    /** Texto da mensagem, ou a legenda quando for arquivo (pode ser nula). */
    content: string | null;
    whatsappMessageId: string | null;
    status: "sent" | "failed";
    error: string | null;
    /** Padrão "text". Para arquivos: image, video, audio ou document. */
    type?: string;
    /** Mensagem crua/metadados (ex.: ID da mídia enviada). */
    payload?: Record<string, unknown>;
  }): Promise<void>;
  /** Marca a conversa como atendida por humano e avança last_message_at. */
  markHumanReplied(conversationId: string, at: string): Promise<void>;
}

export interface SendDeps {
  config: WhatsappConfig;
  /** Valida o token de login e devolve o usuário (ou null). */
  authenticate: (jwt: string) => Promise<AuthUser | null>;
  store: SendStore;
  /** Injetável para testes. */
  send?: (config: WhatsappConfig, input: { to: string; body: string }) => Promise<SendResult>;
  now?: () => number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * POST /api/whatsapp/send — um humano (vendedor responsável ou Head) responde um cliente.
 * Regras:
 *  - exige login válido; vendedor só envia nas conversas ATRIBUÍDAS a ele; Head envia em qualquer uma;
 *  - só texto livre dentro da janela de 24h desde a última mensagem do cliente (fora disso a
 *    Meta só aceita modelos aprovados — fica para uma versão futura);
 *  - quando um humano responde, a conversa passa para status "human" (a IA não responde mais).
 */
export async function handleSend(request: Request, deps: SendDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login para enviar mensagens." }, 401);

  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  let parsed: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) return json({ error: "dados_invalidos", message: "Informe a conversa e um texto de até 4096 caracteres." }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  const conversation = await deps.store.getConversation(parsed.conversation_id);
  // Sem permissão responde igual a "não existe", para não revelar que a conversa existe.
  if (!conversation || (user.role !== "head" && conversation.assigned_seller_id !== user.id)) {
    return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);
  }

  const now = (deps.now ?? Date.now)();
  const lastInbound = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : NaN;
  if (Number.isNaN(lastInbound) || now - lastInbound > WINDOW_MS) {
    return json(
      {
        error: "janela_24h_fechada",
        message: "Já se passaram mais de 24h desde a última mensagem do cliente. O WhatsApp só permite texto livre dentro desse prazo.",
      },
      409,
    );
  }

  const doSend = deps.send ?? sendWhatsappText;
  let result = await doSend(deps.config, { to: conversation.wa_id, body: parsed.text });

  // Brasil: a Meta entrega o número do cliente sem o 9º dígito, mas listas de permissão
  // (número de teste) e alguns envios só reconhecem a forma com o 9. Se a Meta disser que o
  // destinatário "não está na lista" (131030), tenta UMA vez com a forma normalizada.
  const alternate = conversation.telefone_norm;
  if (!result.ok && alternate && alternate !== conversation.wa_id && (result.error ?? "").includes("131030")) {
    result = await doSend(deps.config, { to: alternate, body: parsed.text });
  }

  if (!result.ok || !result.wamid) {
    // Guarda a tentativa como "falhou", para aparecer na conversa com o motivo.
    const reason = result.error ?? "Falha desconhecida no envio";
    await deps.store.insertOutboundMessage({
      conversationId: conversation.id,
      userId: user.id,
      content: parsed.text,
      whatsappMessageId: null,
      status: "failed",
      error: reason,
    });
    return json({ error: "falha_no_envio", message: reason }, 502);
  }

  await deps.store.insertOutboundMessage({
    conversationId: conversation.id,
    userId: user.id,
    content: parsed.text,
    whatsappMessageId: result.wamid,
    status: "sent",
    error: null,
  });
  await deps.store.markHumanReplied(conversation.id, new Date(now).toISOString());

  return json({ ok: true, whatsapp_message_id: result.wamid }, 200);
}
