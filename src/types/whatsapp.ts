export type ConversationStatus = 'ai' | 'human' | 'paused';

export interface Conversation {
  id: string;
  wa_id: string;
  telefone_norm: string;
  contact_name: string | null;
  deal_id: string | null;
  assigned_seller_id: string | null;
  status: ConversationStatus;
  ai_enabled: boolean;
  last_inbound_at: string | null;
  last_message_at: string | null;
  /** Dados do lead descobertos pela IA (só campos permitidos). */
  qualification: Record<string, string> | null;
  created_at: string;
}

export interface SdrConfig {
  ai_enabled: boolean;
  mode: 'shadow' | 'auto';
}

export const QUALIFICATION_LABELS: Record<string, string> = {
  nome: 'Nome',
  origem: 'Origem',
  destino: 'Destino',
  data_mudanca: 'Data',
  bens: 'Bens',
};

export type MessageDirection = 'inbound' | 'outbound';
export type MessageSender = 'contact' | 'ai' | 'human' | 'system';
export type MessageStatus = 'received' | 'draft' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsappMessage {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender: MessageSender;
  sender_user_id: string | null;
  type: string;
  content: string | null;
  status: MessageStatus;
  error: string | null;
  wa_timestamp: string | null;
  /** Mensagem crua da Meta (nome do arquivo de documentos, etc.). */
  payload?: Record<string, any> | null;
  created_at: string;
}

/** Tipos de mensagem que têm um arquivo para exibir. */
export const MEDIA_TYPES = ['image', 'sticker', 'video', 'audio', 'document'];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  ai: 'IA atendendo',
  human: 'Humano',
  paused: 'Pausada',
};

/** Rótulo para tipos de mensagem que ainda não exibimos (áudio, imagem...). */
export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  image: '📷 Imagem',
  audio: '🎤 Áudio',
  video: '🎬 Vídeo',
  document: '📄 Documento',
  sticker: 'Figurinha',
  location: '📍 Localização',
  contacts: '👤 Contato',
  reaction: 'Reação',
  interactive: 'Resposta interativa',
  button: 'Resposta de botão',
  unsupported: 'Mensagem não suportada',
};
