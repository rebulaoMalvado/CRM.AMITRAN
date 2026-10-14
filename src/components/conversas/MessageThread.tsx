import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, ArrowLeft, Bot, Check, CheckCheck, Clock, FileText, Image as ImageIcon, Loader2, Paperclip, Send, UserPlus, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Conversation, CONVERSATION_STATUS_LABEL, MEDIA_TYPES, QUALIFICATION_LABELS, WhatsappMessage } from '@/types/whatsapp';
import MediaBubble from './MediaBubble';
import CreateLeadModal, { LeadFormValues } from './CreateLeadModal';
import { createLeadFromConversation } from '@/lib/whatsapp-api';
import { ACCEPT_ATTR, formatBytes, prepareFileForUpload, validateUpload } from '@/lib/media-utils';
import { Profile } from '@/types/crm';
import { conversationTitle, formatPhone, friendlyError, isWindowOpen, messageText, windowTimeLeft } from '@/lib/whatsapp-utils';

interface Props {
  conversation: Conversation;
  messages: WhatsappMessage[];
  loading: boolean;
  isHead: boolean;
  sellers: Profile[];
  ownerName: string | null;
  sending: boolean;
  assigning: boolean;
  onBack: () => void;
  onSend: (text: string) => Promise<boolean>;
  /** Envia foto, vídeo, áudio ou documento (com legenda opcional). */
  onSendFile: (file: File, caption: string) => Promise<boolean>;
  onAssign: (sellerId: string | null) => void;
  /** Quem pode ligar/desligar a IA nesta conversa (Head ou vendedor responsável). */
  canToggleAi: boolean;
  aiBusy: boolean;
  onToggleAi: (enabled: boolean) => void;
}

const StatusTicks = ({ m }: { m: WhatsappMessage }) => {
  if (m.status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  if (m.status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-info" />;
  if (m.status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 opacity-70" />;
  if (m.status === 'sent') return <Check className="w-3.5 h-3.5 opacity-70" />;
  return <Clock className="w-3 h-3 opacity-70" />;
};

const MessageThread = ({
  conversation, messages, loading, isHead, sellers, ownerName, sending, assigning, onBack, onSend, onSendFile, onAssign,
  canToggleAi, aiBusy, onToggleAi,
}: Props) => {
  const [text, setText] = useState('');
  // No celular os dados do lead ficam recolhidos (sobra mais espaço para as mensagens).
  const [showDetails, setShowDetails] = useState(false);
  // "Gerar lead": a equipe cria o negócio no funil sem esperar a Carol terminar as perguntas.
  const queryClient = useQueryClient();
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);

  const handleCreateLead = async (values: LeadFormValues) => {
    setLeadSubmitting(true);
    try {
      const result = await createLeadFromConversation({
        conversation_id: conversation.id,
        nome: values.nome.trim(),
        origem: values.origem.trim(),
        destino: values.destino.trim(),
        data_mudanca: values.data || null,
      });
      toast.success(result.linked ? 'Conversa ligada ao lead que já existia no funil' : 'Lead criado no funil (Lead Novo)');
      setLeadOpen(false);
      queryClient.invalidateQueries({ queryKey: ['wa-conversations'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLeadSubmitting(false);
    }
  };
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  // Atualiza o relógio da janela de 24h a cada 30s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation.id]);

  // Troca de conversa: limpa o rascunho digitado e o arquivo escolhido.
  useEffect(() => {
    setText('');
    setFile(null);
  }, [conversation.id]);

  // Escolhe o arquivo: reduz fotos grandes e confere tipo/tamanho antes de aceitar.
  const attach = async (picked: File | null | undefined) => {
    if (!picked) return;
    setPreparing(true);
    try {
      const prepared = await prepareFileForUpload(picked);
      const problem = validateUpload(prepared);
      if (problem) {
        toast.error(problem);
        return;
      }
      setFile(prepared);
    } finally {
      setPreparing(false);
    }
  };

  // Fotos/vídeos que o cliente enviou (contam como "lista dos bens" para o consultor de vendas).
  const mediaCount = messages.filter(m => m.direction === 'inbound' && (m.type === 'image' || m.type === 'video')).length;

  const windowOpen = isWindowOpen(conversation.last_inbound_at, now);
  const timeLeft = windowTimeLeft(conversation.last_inbound_at, now);

  const items = useMemo(() => {
    const out: Array<{ kind: 'day'; key: string; date: Date } | { kind: 'msg'; key: string; m: WhatsappMessage }> = [];
    let prev: Date | null = null;
    for (const m of messages) {
      const d = new Date(m.wa_timestamp ?? m.created_at);
      if (!prev || !isSameDay(prev, d)) out.push({ kind: 'day', key: `d-${m.id}`, date: d });
      out.push({ kind: 'msg', key: m.id, m });
      prev = d;
    }
    return out;
  }, [messages]);

  const submit = async () => {
    const value = text.trim();
    if (sending || !windowOpen || preparing) return;
    if (file) {
      const ok = await onSendFile(file, value);
      if (ok) {
        setFile(null);
        setText('');
      }
      return;
    }
    if (!value) return;
    const ok = await onSend(value);
    if (ok) setText('');
  };

  const hasDetails = !!(canToggleAi || mediaCount > 0 || conversation.deal_id || (conversation.qualification && Object.keys(conversation.qualification).length > 0));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Cabeçalho da conversa */}
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border flex flex-wrap items-center gap-x-3 gap-y-2">
        <button onClick={onBack} className="md:hidden p-1.5 rounded-md hover:bg-muted" aria-label="Voltar para a lista">
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-card-foreground truncate">{conversationTitle(conversation)}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatPhone(conversation.telefone_norm || conversation.wa_id)} · {CONVERSATION_STATUS_LABEL[conversation.status]}
            {' · '}
            {windowOpen ? <span className="text-success">janela aberta ({timeLeft})</span> : <span className="text-warning">janela de 24h fechada</span>}
          </div>
        </div>
        <div className="w-full md:w-auto flex flex-wrap items-center justify-between gap-2 md:contents">
          {!conversation.deal_id && (
            <button
              type="button"
              onClick={() => setLeadOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              title="Criar o lead no funil agora, com o que já conversamos"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Gerar lead
            </button>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              aria-expanded={showDetails}
              className="md:hidden text-[11px] px-2 py-1 rounded bg-muted text-muted-foreground"
            >
              {showDetails ? 'Ocultar dados' : 'Dados do lead'}
            </button>
          )}
          {isHead ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Responsável
              <select
                value={conversation.assigned_seller_id ?? ''}
                disabled={assigning}
                onChange={e => onAssign(e.target.value || null)}
                className="px-2 py-1.5 text-xs bg-muted border border-border rounded-md text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Sem dono</option>
                {sellers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {assigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            </label>
          ) : (
            ownerName && <span className="text-xs text-muted-foreground">Responsável: {ownerName}</span>
          )}
        </div>
      </div>

      {/* IA nesta conversa + dados que ela coletou */}
      {hasDetails && (
        <div className={`px-3 sm:px-4 py-2 border-b border-border bg-card/60 ${showDetails ? 'flex' : 'hidden'} md:flex flex-wrap items-center gap-x-4 gap-y-1.5`}>
          {canToggleAi && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="w-3.5 h-3.5" />
              IA nesta conversa
              <input
                type="checkbox"
                checked={conversation.ai_enabled && conversation.status === 'ai'}
                disabled={aiBusy}
                onChange={e => onToggleAi(e.target.checked)}
                className="accent-[hsl(var(--primary))]"
              />
              {aiBusy && <Loader2 className="w-3 h-3 animate-spin" />}
            </label>
          )}
          {conversation.deal_id && (
            <Link
              to="/"
              className="text-[11px] px-2 py-0.5 rounded bg-primary/15 text-primary font-medium hover:bg-primary/25 transition-colors"
              title="Esta conversa já virou um negócio no funil (etapa Lead Novo)"
            >
              ✓ Negócio criado no funil
            </Link>
          )}
          {mediaCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-card-foreground">
              <span className="text-muted-foreground">Fotos/vídeos:</span> {mediaCount}
            </span>
          )}
          {conversation.qualification &&
            Object.entries(conversation.qualification)
              .filter(([key]) => key !== 'data_iso') // versão técnica da data: não precisa aparecer
              .map(([key, value]) => (
              <span key={key} className="text-[11px] px-2 py-0.5 rounded bg-muted text-card-foreground">
                <span className="text-muted-foreground">{QUALIFICATION_LABELS[key] ?? key}:</span> {value}
              </span>
            ))}
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-background">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">Sem mensagens nesta conversa.</div>
        ) : (
          items.map(item => {
            if (item.kind === 'day') {
              return (
                <div key={item.key} className="flex justify-center py-1">
                  <span className="px-3 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground">
                    {format(item.date, "dd 'de' MMMM", { locale: ptBR })}
                  </span>
                </div>
              );
            }
            const m = item.m;
            const mine = m.direction === 'outbound';
            const draft = m.status === 'draft';
            return (
              <div key={item.key} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-card-foreground rounded-bl-sm'
                  } ${draft ? 'opacity-70 border border-dashed border-current' : ''}`}
                >
                  {mine && m.sender === 'ai' && (
                    <div className="flex items-center gap-1 text-[10px] font-medium opacity-80 mb-0.5">
                      <Bot className="w-3 h-3" /> {draft ? 'Rascunho da Carol (não enviado)' : 'Carol (automático)'}
                    </div>
                  )}
                  {MEDIA_TYPES.includes(m.type) && m.status !== 'failed' && (
                    <MediaBubble messageId={m.id} type={m.type} fileName={m.payload?.document?.filename} />
                  )}
                  {/* Foto/vídeo/áudio sem legenda: o próprio arquivo já aparece, sem o aviso de texto. */}
                  {(m.content || !MEDIA_TYPES.includes(m.type) || m.status === 'failed') && messageText(m)}
                  {draft && windowOpen && m.content && (
                    <button
                      type="button"
                      onClick={() => setText(m.content as string)}
                      className="mt-1.5 block text-[11px] font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      Usar este rascunho
                    </button>
                  )}
                  <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${mine ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {format(new Date(m.wa_timestamp ?? m.created_at), 'HH:mm')}
                    {mine && <StatusTicks m={m} />}
                  </div>
                  {mine && m.status === 'failed' && m.error && (
                    <div className="mt-1 text-[11px] text-destructive-foreground bg-destructive/80 rounded px-2 py-1 space-y-1">
                      <div className="font-medium">Não enviada{friendlyError(m.error) ? `: ${friendlyError(m.error)}` : ''}</div>
                      <div className="opacity-80">Detalhe técnico: {m.error}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Caixa de resposta */}
      <div className="border-t border-border p-3 bg-card">
        {!windowOpen && (
          <div className="mb-2 text-xs text-warning bg-warning/10 rounded-md px-3 py-2">
            A janela de 24h fechou. O WhatsApp só permite mensagem livre até 24h depois da última mensagem do cliente.
            Quando ele escrever de novo, a conversa libera.
          </div>
        )}
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-card-foreground">
            {file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
            <span className="truncate font-medium">{file.name}</span>
            <span className="text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
            <span className="text-muted-foreground hidden sm:inline">· o texto abaixo vira a legenda</span>
            <button type="button" onClick={() => setFile(null)} className="ml-auto p-1 rounded hover:bg-background/60" aria-label="Remover arquivo">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={e => {
              attach(e.target.files?.[0]);
              e.target.value = ''; // permite escolher o mesmo arquivo de novo
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!windowOpen || sending || preparing}
            title="Anexar foto, vídeo, áudio ou documento (PDF, Word, Excel...)"
            aria-label="Anexar arquivo"
            className="p-2.5 rounded-lg bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onPaste={e => {
              // Ctrl+V com uma imagem copiada (print, foto) vira anexo.
              const pasted = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
              if (pasted) {
                e.preventDefault();
                attach(pasted);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={4096}
            disabled={!windowOpen || sending}
            placeholder={windowOpen ? (file ? 'Legenda (opcional)... Enter envia' : 'Escreva uma resposta... (Enter envia, Shift+Enter quebra a linha)') : 'Janela fechada'}
            className="flex-1 resize-none px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
          />
          <button
            onClick={submit}
            disabled={(!text.trim() && !file) || !windowOpen || sending || preparing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Enviar</span>
          </button>
        </div>
      </div>
      {leadOpen && <CreateLeadModal conversation={conversation} submitting={leadSubmitting} onSubmit={handleCreateLead} onClose={() => setLeadOpen(false)} />}
    </div>
  );
};

export default MessageThread;
