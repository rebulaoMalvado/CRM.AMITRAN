import { normalizePhone } from "./phone.js";
import type { DeliveryStatus, InboundMessage, InboundStatus, OutboundEcho } from "./whatsapp-parse.js";

/**
 * O que o webhook precisa do banco. Fica como "contrato" para podermos testar a
 * lógica sem banco de verdade (ver supabase-store.ts para a versão real).
 */
export interface InboundStore {
  /** Cria a conversa se não existir (ou atualiza nome/telefone). Devolve o id. */
  upsertConversation(input: {
    waId: string;
    telefoneNorm: string;
    contactName: string | null;
  }): Promise<string>;

  /** Grava a mensagem. Devolve false se o whatsapp_message_id já existia (duplicada). */
  insertInboundMessage(input: {
    conversationId: string;
    message: InboundMessage;
  }): Promise<boolean>;

  /** Grava a mensagem que a empresa enviou pelo app do celular. Devolve false se já existia. */
  insertOutboundEcho(input: { conversationId: string; echo: OutboundEcho }): Promise<boolean>;

  /** Humano atendeu (pelo celular): conversa vira "human" e last_message_at avança. */
  markHumanActivity(conversationId: string, at: string): Promise<void>;

  /** Avança last_inbound_at / last_message_at — nunca anda para trás. */
  touchConversation(conversationId: string, at: string): Promise<void>;

  /**
   * Atualiza o status de uma mensagem NOSSA (outbound) pelo whatsapp_message_id,
   * somente se o status atual estiver em `allowedPrevious`. Devolve true se atualizou.
   */
  applyStatus(input: {
    whatsappMessageId: string;
    status: DeliveryStatus;
    allowedPrevious: string[];
    errorText: string | null;
  }): Promise<boolean>;
}

/**
 * Ordem do ciclo de vida de uma mensagem enviada: queued → sent → delivered → read.
 * O status só avança (a Meta pode entregar os avisos fora de ordem). "failed" só
 * vale enquanto a mensagem ainda não foi entregue.
 */
export const ALLOWED_PREVIOUS_STATUS: Record<DeliveryStatus, string[]> = {
  sent: ["queued"],
  delivered: ["queued", "sent"],
  read: ["queued", "sent", "delivered"],
  failed: ["queued", "sent"],
};

/** Aplica UMA atualização de status. Seguro para repetir (idempotente). */
export async function applyStatusUpdate(
  store: InboundStore,
  update: InboundStatus,
): Promise<{ applied: boolean }> {
  const applied = await store.applyStatus({
    whatsappMessageId: update.whatsappMessageId,
    status: update.status,
    allowedPrevious: ALLOWED_PREVIOUS_STATUS[update.status],
    errorText: update.status === "failed" ? update.errorText ?? "Falha informada pela Meta" : null,
  });
  return { applied };
}

/**
 * Guarda UMA mensagem recebida. Seguro para repetir: se a Meta reenviar o mesmo
 * webhook, a mensagem não é duplicada (idempotência por whatsapp_message_id).
 * Não chama IA e não envia nada — só registra (a IA roda depois, de forma assíncrona).
 */
export async function ingestInboundMessage(
  store: InboundStore,
  message: InboundMessage,
): Promise<{ stored: boolean; conversationId: string }> {
  const conversationId = await store.upsertConversation({
    waId: message.waId,
    telefoneNorm: normalizePhone(message.waId),
    contactName: message.contactName,
  });

  const stored = await store.insertInboundMessage({ conversationId, message });

  // Sempre atualiza (mesmo se duplicada): assim, se uma tentativa anterior caiu
  // entre "gravar a mensagem" e "atualizar a conversa", o reenvio conserta.
  await store.touchConversation(conversationId, message.waTimestamp ?? new Date().toISOString());

  return { stored, conversationId };
}

/**
 * Guarda UMA mensagem que a empresa digitou no app do celular (Coexistence).
 * Cria a conversa se for a primeira vez que a empresa escreve para esse número.
 * Seguro para repetir (idempotente por whatsapp_message_id).
 */
export async function ingestOutboundEcho(
  store: InboundStore,
  echo: OutboundEcho,
): Promise<{ stored: boolean }> {
  const conversationId = await store.upsertConversation({
    waId: echo.waId,
    telefoneNorm: normalizePhone(echo.waId),
    contactName: null,
  });

  const stored = await store.insertOutboundEcho({ conversationId, echo });
  // Mesmo se duplicada, repete a marcação: conserta uma tentativa anterior que caiu no meio.
  await store.markHumanActivity(conversationId, echo.waTimestamp ?? new Date().toISOString());
  return { stored };
}
