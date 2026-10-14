import { useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';
import { Conversation } from '@/types/whatsapp';

export interface LeadFormValues {
  nome: string;
  origem: string;
  destino: string;
  /** AAAA-MM-DD ou vazio. */
  data: string;
}

interface Props {
  conversation: Conversation;
  submitting: boolean;
  onSubmit: (values: LeadFormValues) => void;
  onClose: () => void;
}

const inputClass =
  'w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

/** Nome de contato que parece só um telefone não serve como nome do lead. */
const looksLikePhone = (value: string) => value.replace(/\D/g, '').length >= 8;

/** Formulário já preenchido com o que a Carol coletou; a equipe confere, completa e confirma. */
const CreateLeadModal = ({ conversation, submitting, onSubmit, onClose }: Props) => {
  const q = conversation.qualification ?? {};
  const contactName = conversation.contact_name && !looksLikePhone(conversation.contact_name) ? conversation.contact_name : '';
  const [form, setForm] = useState<LeadFormValues>({
    nome: q.nome || contactName,
    origem: q.origem || '',
    destino: q.destino || '',
    data: /^\d{4}-\d{2}-\d{2}$/.test(q.data_iso || '') ? q.data_iso : '',
  });

  const canSubmit = !!form.nome.trim() && !!form.origem.trim() && !!form.destino.trim() && !submitting;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-card-foreground">Gerar lead no funil</h2>
            <p className="text-xs text-muted-foreground mt-1">Entra como "Lead Novo". Valor e tipo de serviço você define depois.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            if (canSubmit) onSubmit(form);
          }}
          className="p-5 space-y-4"
        >
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome *</label>
            <input autoFocus value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} className={inputClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Origem *</label>
              <input value={form.origem} onChange={e => setForm(p => ({ ...p, origem: e.target.value }))} placeholder="Bairro / cidade" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Destino *</label>
              <input value={form.destino} onChange={e => setForm(p => ({ ...p, destino: e.target.value }))} placeholder="Bairro / cidade" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data da mudança (opcional)</label>
            <input type="date" value={form.data} onChange={e => setForm(p => ({ ...p, data: e.target.value }))} className={inputClass} />
            {q.data_mudanca && <p className="text-[11px] text-muted-foreground mt-1">O cliente disse: "{q.data_mudanca}"</p>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            O telefone vem da conversa. Ao gerar o lead, a Carol para de responder nesta conversa e quem atende é a equipe.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-card-foreground">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Gerar lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateLeadModal;
