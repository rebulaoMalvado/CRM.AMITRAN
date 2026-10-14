import { supabase } from '@/lib/supabase';
import type { PropostaForm } from '@/lib/proposta';

interface ApiError {
  error?: string;
  message?: string;
}

/**
 * Chama os endereços /api/whatsapp/* do CRM com o login do usuário.
 * Quem de fato valida permissão e escreve no banco é o servidor — o navegador só pede.
 */
async function post<T extends object>(path: string, body: object): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(json.message || `Erro ${res.status}`);
  return json;
}

export const sendWhatsappMessage = (conversationId: string, text: string) =>
  post<{ ok: true; whatsapp_message_id: string }>('/api/whatsapp/send', { conversation_id: conversationId, text });

export const assignConversation = (conversationId: string, sellerId: string | null) =>
  post<{ ok: true }>('/api/whatsapp/assign', { conversation_id: conversationId, seller_id: sellerId });

/** A equipe cria o lead no funil a partir da conversa, sem esperar a Carol terminar as perguntas. */
export const createLeadFromConversation = (input: {
  conversation_id: string;
  nome: string;
  origem: string;
  destino: string;
  data_mudanca: string | null;
}) => post<{ ok: true; deal_id: string; linked: boolean }>('/api/whatsapp/assign?op=create-lead', input);

export interface SimMessage {
  from: 'customer' | 'victoria';
  type: 'text' | 'image';
  content: string;
}

export interface SimResult {
  reply: string | null;
  handoff: boolean;
  handoffReason: string | null;
  qualification: Record<string, string>;
  leadWouldBeCreated: boolean;
  blockedByPriceFilter: boolean;
  businessHours: boolean;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/** Simulador (somente Head): roda UMA rodada da Carol sem gravar nada, sem WhatsApp, sem lead e sem aviso. */
export const simulateVictoria = (input: { messages: SimMessage[]; known: Record<string, string>; after_hours?: boolean }) =>
  post<{ ok: true } & SimResult>('/api/sdr/config?op=simulate', input);

/** Liga/desliga a IA para todo o CRM e/ou escolhe o modo (somente Head). */
export const setSdrConfig = (input: { ai_enabled?: boolean; mode?: 'shadow' | 'auto' }) =>
  post<{ ok: true }>('/api/sdr/config', input);

/** Liga/desliga a IA em UMA conversa (Head ou vendedor responsável). */
export const setConversationAi = (conversationId: string, enabled: boolean) =>
  post<{ ok: true }>('/api/sdr/conversation', { conversation_id: conversationId, ai_enabled: enabled });

/**
 * Busca a foto/vídeo/áudio/documento de UMA mensagem (o servidor confere se o usuário pode ver a
 * conversa). Devolve um endereço temporário do navegador (blob:) para exibir o arquivo.
 */
export async function fetchMessageMedia(messageId: string): Promise<{ url: string; mime: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const res = await fetch(`/api/whatsapp/media?message=${encodeURIComponent(messageId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(json.message || `Erro ${res.status}`);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mime: blob.type };
}

/** Envia foto, vídeo, áudio ou documento (com legenda opcional) pelo WhatsApp. */
export async function sendWhatsappFile(conversationId: string, file: File, caption: string): Promise<{ ok: true; whatsapp_message_id: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const form = new FormData();
  form.set('conversation_id', conversationId);
  form.set('file', file, file.name);
  if (caption.trim()) form.set('caption', caption.trim());

  const res = await fetch('/api/whatsapp/send-media', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const json = (await res.json().catch(() => ({}))) as { ok?: true; whatsapp_message_id?: string } & ApiError;
  if (!res.ok) throw new Error(json.message || `Erro ${res.status}`);
  return json as { ok: true; whatsapp_message_id: string };
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  return token;
}

/** O servidor gera o PDF da proposta (mesmo motor da impressão do Chrome) e devolve o arquivo. */
export async function downloadPropostaPdf(dealId: string, form: PropostaForm): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch('/api/proposta/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await authToken()}` },
    body: JSON.stringify({ deal_id: dealId, form }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(json.message || `Erro ${res.status}`);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return { blob: await res.blob(), filename: encoded ? decodeURIComponent(encoded) : 'Proposta Amitran.pdf' };
}

/** Gera o PDF no servidor e envia ao cliente pela conversa de WhatsApp do lead. */
export async function sendPropostaWhatsapp(dealId: string, form: PropostaForm, caption?: string): Promise<void> {
  const res = await fetch('/api/proposta/enviar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await authToken()}` },
    body: JSON.stringify({ deal_id: dealId, form, caption, mark_sent: true }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(json.message || `Erro ${res.status}`);
  }
}
