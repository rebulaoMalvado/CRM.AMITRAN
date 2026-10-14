import { MESSAGE_TYPE_LABEL, WhatsappMessage } from '@/types/whatsapp';

/** Janela de atendimento do WhatsApp: texto livre só até 24h depois da última mensagem do cliente. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWindowOpen(lastInboundAt: string | null, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return !Number.isNaN(t) && now - t <= WINDOW_MS;
}

/** Tempo restante da janela, em texto curto ("3h 20min"), ou null se já fechou. */
export function windowTimeLeft(lastInboundAt: string | null, now: number = Date.now()): string | null {
  if (!isWindowOpen(lastInboundAt, now)) return null;
  const left = WINDOW_MS - (now - Date.parse(lastInboundAt as string));
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

/** 5531988880001 -> "+55 (31) 98888-0001". Outros formatos: "+" + dígitos. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : raw;
}

/** Texto que aparece na bolha: o conteúdo, ou um rótulo para mídias sem texto. */
export function messageText(m: Pick<WhatsappMessage, 'type' | 'content'>): string {
  if (m.content) return m.content;
  return MESSAGE_TYPE_LABEL[m.type] ?? 'Mensagem';
}

/** Nome para exibir: o do WhatsApp, ou o telefone formatado. */
export function conversationTitle(c: { contact_name: string | null; telefone_norm: string; wa_id: string }): string {
  return c.contact_name?.trim() || formatPhone(c.telefone_norm || c.wa_id);
}

/** Explicações em português para os erros mais comuns da Meta (pelo código de 5-6 dígitos). */
const FRIENDLY_ERRORS: Record<string, string> = {
  '130497': 'A Meta não deixa este número enviar mensagens para clientes deste país. O número de teste da Meta (EUA) não pode escrever para o Brasil; com um número brasileiro de verdade isso deixa de acontecer.',
  '131030': 'O destinatário não está na lista de permitidos do número de teste da Meta.',
  '131047': 'Já passou de 24h desde a última mensagem do cliente. O WhatsApp só permite modelo de mensagem aprovado agora.',
  '131026': 'A mensagem não pôde ser entregue (o número pode não ter WhatsApp ou ter bloqueado a empresa).',
  '131056': 'Muitas mensagens para o mesmo número em pouco tempo. Aguarde um pouco e tente de novo.',
  '190': 'O acesso do CRM à Meta expirou ou é inválido. Avise o administrador.',
};

/** Devolve uma explicação amigável do erro, quando conhecemos o código. */
export function friendlyError(error: string | null): string | null {
  if (!error) return null;
  // O texto pode trazer o código HTTP (ex.: 400) antes do código da Meta: testa todos os números.
  for (const [code] of error.matchAll(/\b\d{3,6}\b/g)) {
    if (FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  }
  return null;
}
