import type { SendResult } from "../whatsapp-send.js";
import { phoneKey } from "../phone.js";

const WINDOW_MS = 24 * 3600_000;

/** Dados do lead que vão no aviso (só o que o vendedor precisa para começar). */
export interface LeadNotice {
  conversationId: string;
  nome: string;
  origem: string;
  destino: string;
  /** Data do jeito que o cliente falou (ex.: "dia 15 de novembro"). */
  dataLabel: string;
}

/** Conversa do VENDEDOR com o número da empresa (se ele já escreveu alguma vez). */
export interface SellerConversationInfo {
  waId: string;
  telefoneNorm: string | null;
  lastInboundAt: string | null;
}

export interface NotifyDeps {
  /** id do vendedor (profiles.id) -> telefone dele. Vem de SELLER_NOTIFY_PHONES. */
  phones: Record<string, string>;
  /** Link base do CRM (sem barra no fim). */
  crmUrl: string;
  /** Nome do modelo aprovado na Meta. Sem ele, só avisa quando a janela de 24h do vendedor está aberta. */
  templateName?: string;
  templateLanguage?: string;
  findSellerConversation(phoneKey: string): Promise<SellerConversationInfo | null>;
  sendText(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, name: string, language: string, bodyParams: string[]): Promise<SendResult>;
  now?: () => number;
}

export type NotifyOutcome =
  | "sent_text"
  | "sent_template"
  | "no_phone"
  | "window_closed_no_template"
  | "failed";

/** WhatsApp não aceita quebra de linha nem espaços repetidos dentro de variável de modelo. */
export function oneLine(value: string, max = 120): string {
  const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
  return clean || "não informado";
}

export function parseSellerPhones(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [id, phone] = part.split("=").map((x) => x.trim());
    const key = phone ? phoneKey(phone) : "";
    if (id && key) out[id] = key;
  }
  return out;
}

/** Texto livre (só dentro da janela de 24h do vendedor). */
export function buildText(lead: LeadNotice, crmUrl: string): string {
  return [
    "Segue novo lead qualificado prontinho pro fechamento:",
    "",
    `Cliente: ${oneLine(lead.nome)}`,
    `Origem: ${oneLine(lead.origem)}`,
    `Destino: ${oneLine(lead.destino)}`,
    `Data: ${oneLine(lead.dataLabel)}`,
    "",
    `Abrir a conversa: ${crmUrl}/conversas?conversa=${lead.conversationId}`,
    "",
    "Sem pressão? É OBRIGATÓRIO fechar! CHAMA! 🔥",
  ].join("\n");
}

export interface NotifyResult {
  outcome: NotifyOutcome;
  /** Motivo curto devolvido pela Meta quando falhou (sem token, sem dados do cliente). */
  error?: string;
}

/**
 * Avisa o vendedor no WhatsApp. Nunca lança erro (o aviso não pode atrapalhar a conversa).
 * Dentro da janela de 24h manda texto normal; fora dela precisa do modelo aprovado.
 */
export async function notifySeller(deps: NotifyDeps, sellerId: string, lead: LeadNotice): Promise<NotifyOutcome> {
  return (await notifySellerDetailed(deps, sellerId, lead)).outcome;
}

/** Igual ao notifySeller, mas devolve também o motivo da falha (para log e para o botão de teste). */
export async function notifySellerDetailed(deps: NotifyDeps, sellerId: string, lead: LeadNotice): Promise<NotifyResult> {
  try {
    const phone = deps.phones[sellerId];
    if (!phone) return { outcome: "no_phone" };

    const conv = await deps.findSellerConversation(phone);
    const lastInbound = conv?.lastInboundAt ? Date.parse(conv.lastInboundAt) : NaN;
    const windowOpen = !Number.isNaN(lastInbound) && (deps.now ?? Date.now)() - lastInbound <= WINDOW_MS;
    // O wa_id é o jeito que a Meta conhece o número (às vezes sem o 9º dígito).
    const to = conv?.waId ?? phone;

    let textError: string | undefined;
    if (windowOpen) {
      const sent = await deps.sendText(to, buildText(lead, deps.crmUrl));
      if (sent.ok) return { outcome: "sent_text" };
      textError = sent.error;
      // Janela "aberta" no nosso relógio mas fechada na Meta: cai para o modelo.
    }

    if (!deps.templateName) return windowOpen ? { outcome: "failed", error: textError } : { outcome: "window_closed_no_template" };
    const params = [oneLine(lead.nome), oneLine(lead.origem), oneLine(lead.destino), oneLine(lead.dataLabel)];
    const sent = await deps.sendTemplate(to, deps.templateName, deps.templateLanguage || "pt_BR", params);
    return sent.ok ? { outcome: "sent_template" } : { outcome: "failed", error: sent.error };
  } catch (err) {
    return { outcome: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "erro inesperado" };
  }
}
