import { z } from "zod";

/** Uma mensagem recebida do cliente, já no formato que o CRM grava. */
export interface InboundMessage {
  waId: string;
  contactName: string | null;
  whatsappMessageId: string;
  type: string;
  content: string | null;
  /** Mensagem crua da Meta (auditoria, mídia, tipos que ainda não tratamos). */
  payload: Record<string, unknown>;
  /** Horário informado pela Meta (ISO) — null se vier inválido. */
  waTimestamp: string | null;
}

/**
 * Mensagem que a NOSSA empresa enviou pelo app WhatsApp Business no celular
 * (evento "smb_message_echoes" do Coexistence). Aparece no CRM como mensagem de saída.
 */
export interface OutboundEcho {
  /** Número do cliente (destinatário). */
  waId: string;
  whatsappMessageId: string;
  type: string;
  content: string | null;
  payload: Record<string, unknown>;
  waTimestamp: string | null;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

/** Atualização de status de uma mensagem NOSSA (enviada, entregue, lida ou falhou). */
export interface InboundStatus {
  whatsappMessageId: string;
  status: DeliveryStatus;
  /** Horário informado pela Meta (ISO) — null se vier inválido. */
  at: string | null;
  /** Motivo, quando status = failed. */
  errorText: string | null;
}

export interface ParseResult {
  messages: InboundMessage[];
  /** Mensagens enviadas pelo app do celular (Coexistence). */
  echoes: OutboundEcho[];
  /** Mensagens ignoradas por estarem malformadas (sem id ou sem número). */
  skipped: number;
  /** Quantidade bruta de atualizações de status recebidas (inclusive as ignoradas). */
  statusCount: number;
  /** Atualizações de status válidas (sent / delivered / read / failed). */
  statuses: InboundStatus[];
}

// O "envelope" é lido de forma permissiva de propósito: a Meta pode acrescentar
// campos novos e isso nunca deve fazer a gente perder uma mensagem do cliente.
const messageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().optional(),
    type: z.string().default("unsupported"),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    timestamp: z.string().optional(),
    errors: z
      .array(
        z
          .object({
            code: z.union([z.number(), z.string()]).optional(),
            title: z.string().optional(),
            message: z.string().optional(),
            error_data: z.object({ details: z.string().optional() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const echoSchema = z
  .object({
    to: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().optional(),
    type: z.string().default("unsupported"),
  })
  .passthrough();

const DELIVERY_STATUSES = new Set<string>(["sent", "delivered", "read", "failed"]);

const valueSchema = z
  .object({
    contacts: z
      .array(
        z
          .object({
            wa_id: z.string().optional(),
            profile: z.object({ name: z.string().optional() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
    messages: z.array(z.unknown()).optional(),
    statuses: z.array(z.unknown()).optional(),
    message_echoes: z.array(z.unknown()).optional(),
  })
  .passthrough();

const envelopeSchema = z
  .object({
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z.object({ field: z.string().optional(), value: z.unknown() }).passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const WA_ID_PATTERN = /^\d{8,15}$/;

type Raw = Record<string, any>;

/** Extrai o texto "legível" de cada tipo de mensagem (quando existir). */
export function extractContent(msg: Raw): string | null {
  const type: string = msg.type;
  const body = msg[type] as Raw | undefined;

  switch (type) {
    case "text":
      return body?.body ?? null;
    case "image":
    case "video":
    case "document":
      return body?.caption ?? null;
    case "button":
      return body?.text ?? null;
    case "interactive":
      return body?.button_reply?.title ?? body?.list_reply?.title ?? null;
    case "reaction":
      return body?.emoji ?? null;
    default:
      return null;
  }
}

function toIso(unixSeconds: string | undefined): string | null {
  if (!unixSeconds || !/^\d+$/.test(unixSeconds)) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Resume o erro da Meta em 1 linha curta (sem dados do cliente). */
function describeError(error: Raw | undefined): string | null {
  if (!error) return null;
  const parts = [error.code, error.title ?? error.message, error.error_data?.details];
  const text = parts.filter((p) => p !== undefined && p !== null && p !== "").join(" · ");
  return text ? text.slice(0, 500) : null;
}

/** Lê o corpo (JSON) do webhook e devolve só o que o CRM precisa. */
export function parseWebhookPayload(json: unknown): ParseResult {
  const result: ParseResult = { messages: [], echoes: [], skipped: 0, statusCount: 0, statuses: [] };

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return result;

  for (const entry of envelope.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" && change.field !== "smb_message_echoes") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;

      for (const rawEcho of value.data.message_echoes ?? []) {
        const echo = echoSchema.safeParse(rawEcho);
        if (!echo.success || !WA_ID_PATTERN.test(echo.data.to)) {
          result.skipped += 1;
          continue;
        }
        const e = echo.data as Raw;
        result.echoes.push({
          waId: e.to,
          whatsappMessageId: e.id,
          type: e.type,
          content: extractContent(e),
          payload: e,
          waTimestamp: toIso(e.timestamp),
        });
      }

      result.statusCount += value.data.statuses?.length ?? 0;
      for (const rawStatus of value.data.statuses ?? []) {
        const parsed = statusSchema.safeParse(rawStatus);
        if (!parsed.success || !DELIVERY_STATUSES.has(parsed.data.status)) continue;
        result.statuses.push({
          whatsappMessageId: parsed.data.id,
          status: parsed.data.status as DeliveryStatus,
          at: toIso(parsed.data.timestamp),
          errorText: describeError(parsed.data.errors?.[0]),
        });
      }

      const names = new Map<string, string>();
      for (const contact of value.data.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) names.set(contact.wa_id, contact.profile.name);
      }

      for (const rawMsg of value.data.messages ?? []) {
        const msg = messageSchema.safeParse(rawMsg);
        if (!msg.success || !WA_ID_PATTERN.test(msg.data.from)) {
          result.skipped += 1;
          continue;
        }
        const m = msg.data as Raw;
        result.messages.push({
          waId: m.from,
          contactName: names.get(m.from) ?? null,
          whatsappMessageId: m.id,
          type: m.type,
          content: extractContent(m),
          payload: m,
          waTimestamp: toIso(m.timestamp),
        });
      }
    }
  }
  return result;
}
