import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RotateCcw, Send, ShieldAlert, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { QUALIFICATION_LABELS } from '@/types/whatsapp';
import { SimMessage, SimResult, simulateVictoria } from '@/lib/whatsapp-api';

interface Props {
  onClose: () => void;
}

type HoursMode = 'auto' | 'fora' | 'dentro';

const FIELD_ORDER = ['nome', 'origem', 'destino', 'data_mudanca', 'bens'];

/**
 * Simulador da Carol (somente Head): conversa de teste que usa o MESMO prompt, modelo e travas da
 * conversa real, mas não grava nada, não manda WhatsApp, não cria lead e não avisa vendedor.
 */
const SimulatorModal = ({ onClose }: Props) => {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [known, setKnown] = useState<Record<string, string>>({});
  const [last, setLast] = useState<SimResult | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<HoursMode>('auto');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const pending = messages.length > 0 && messages[messages.length - 1].from === 'customer';
  const canSend = !loading && (text.trim().length > 0 || pending);

  const run = async (all: SimMessage[]) => {
    setLoading(true);
    try {
      const res = await simulateVictoria({
        messages: all,
        known,
        after_hours: hours === 'auto' ? undefined : hours === 'fora',
      });
      setKnown(res.qualification);
      setLast(res);
      if (res.reply) setMessages([...all, { from: 'victoria', type: 'text', content: res.reply }]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const send = () => {
    if (!canSend) return;
    const value = text.trim();
    const all: SimMessage[] = value ? [...messages, { from: 'customer', type: 'text', content: value }] : messages;
    setMessages(all);
    setText('');
    void run(all);
  };

  const addPhoto = () => setMessages(prev => [...prev, { from: 'customer', type: 'image', content: '' }]);

  const reset = () => {
    setMessages([]);
    setKnown({});
    setLast(null);
    setText('');
  };

  const photos = messages.filter(m => m.from === 'customer' && m.type === 'image').length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content !max-w-4xl w-full flex flex-col max-h-[92dvh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-card-foreground">Testar a Carol</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Você escreve como cliente e ela responde com o mesmo prompt e modelo da conversa real. Nada é gravado, nenhum WhatsApp é enviado e nenhum lead é criado.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card/60 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Horário
            <select
              value={hours}
              onChange={e => setHours(e.target.value as HoursMode)}
              className="px-2 py-1 text-xs bg-muted border border-border rounded-md text-card-foreground"
            >
              <option value="auto">Relógio de verdade</option>
              <option value="dentro">Simular horário comercial</option>
              <option value="fora">Simular fora do horário</option>
            </select>
          </label>
          <button onClick={reset} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-accent text-card-foreground">
            <RotateCcw className="w-3 h-3" /> Zerar conversa
          </button>
          {last && <span className="ml-auto">modelo: {last.model} · {last.usage.inputTokens + last.usage.outputTokens} tokens</span>}
        </div>

        <div className="flex-1 min-h-0 grid md:grid-cols-[1fr_260px]">
          <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-border">
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-background min-h-[220px]">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Escreva a primeira mensagem do cliente, por exemplo: "oi, quero fazer uma mudança".
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'customer' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.from === 'customer' ? 'bg-muted text-card-foreground' : 'bg-primary text-primary-foreground'
                    }`}
                  >
                    <div className="text-[10px] font-medium opacity-70 mb-0.5">{m.from === 'customer' ? 'Cliente (você)' : 'Carol'}</div>
                    {m.type === 'image' ? '📷 foto enviada' : m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-end">
                  <div className="rounded-2xl px-3.5 py-2 text-sm bg-primary/20 text-card-foreground inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carol está escrevendo…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="p-3 border-t border-border flex items-end gap-2">
              <button
                onClick={addPhoto}
                disabled={loading}
                title="Simular o envio de uma foto (ela não vê a imagem, só sabe que chegou)"
                className="p-2.5 rounded-lg bg-muted hover:bg-accent disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
              </button>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Escreva como o cliente (Enter envia, Shift+Enter quebra a linha)"
                className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
              <button
                onClick={send}
                disabled={!canSend}
                className="p-2.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                aria-label="Enviar"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto text-xs">
            <div className="font-semibold text-card-foreground text-sm">O que ela anotou</div>
            <ul className="space-y-1.5">
              {FIELD_ORDER.map(key => (
                <li key={key}>
                  <span className="text-muted-foreground">{QUALIFICATION_LABELS[key] ?? key}: </span>
                  <span className={known[key] ? 'text-card-foreground' : 'text-muted-foreground/60'}>{known[key] || '—'}</span>
                </li>
              ))}
              <li>
                <span className="text-muted-foreground">Fotos/vídeos: </span>
                <span className="text-card-foreground">{photos}</span>
              </li>
            </ul>

            {last?.leadWouldBeCreated && (
              <div className="flex items-start gap-2 rounded-lg bg-primary/15 text-primary p-2 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> Na vida real o lead seria criado no funil agora e o vendedor da vez seria avisado.
              </div>
            )}
            {last?.handoff && (
              <div className="flex items-start gap-2 rounded-lg bg-muted text-card-foreground p-2">
                <UserCheck className="w-4 h-4 shrink-0" /> Aqui ela encaminharia para a equipe e sairia da conversa. Motivo: {last.handoffReason || '—'}
              </div>
            )}
            {last?.blockedByPriceFilter && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/15 text-destructive p-2">
                <ShieldAlert className="w-4 h-4 shrink-0" /> O filtro de preço barrou a resposta dela. O cliente receberia a mensagem fixa.
              </div>
            )}
            {last && !last.businessHours && <div className="text-muted-foreground">Simulando fora do horário comercial.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulatorModal;
