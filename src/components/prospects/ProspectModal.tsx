import { useState, useEffect } from 'react';
import { Prospect, ProspectStatus, PROSPECT_STATUS_LABEL } from '@/types/crm';
import { useAuth } from '@/contexts/AuthContext';
import { X, Trash2, Save, Building2, User, Phone, Mail, Calendar, FileText } from 'lucide-react';

interface Props {
  prospect?: Prospect | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (p: Omit<Prospect, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => void | Promise<void>;
  onUpdate?: (id: string, updates: Partial<Prospect>) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
}

const empty = {
  empresa: '',
  contatoNome: '',
  telefone: '',
  email: '',
  status: 'frio' as ProspectStatus,
  ultimoContato: '',
  proximoContato: '',
  observacoes: '',
};

const ProspectModal = ({ prospect, isOpen, onClose, onSave, onUpdate, onDelete }: Props) => {
  const { isHead } = useAuth();
  const [form, setForm] = useState(empty);
  const isEditing = !!prospect;

  useEffect(() => {
    if (prospect) {
      setForm({
        empresa: prospect.empresa,
        contatoNome: prospect.contatoNome,
        telefone: prospect.telefone,
        email: prospect.email,
        status: prospect.status,
        ultimoContato: prospect.ultimoContato || '',
        proximoContato: prospect.proximoContato || '',
        observacoes: prospect.observacoes,
      });
    } else {
      setForm(empty);
    }
  }, [prospect]);

  if (!isOpen) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      empresa: form.empresa,
      contatoNome: form.contatoNome,
      telefone: form.telefone,
      email: form.email,
      status: form.status,
      ultimoContato: form.ultimoContato || undefined,
      proximoContato: form.proximoContato || undefined,
      observacoes: form.observacoes,
    };
    if (isEditing && onUpdate) onUpdate(prospect!.id, payload);
    else onSave(payload);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-card-foreground">
              {isEditing ? 'Editar Prospect' : 'Novo Prospect'}
            </h2>
            {isEditing && isHead && prospect?.sellerName && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary mt-1">
                <User className="w-3 h-3" />
                Vendedor: {prospect.sellerName}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Empresa
            </label>
            <input
              required
              value={form.empresa}
              onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <User className="w-3 h-3" /> Nome do contato
              </label>
              <input
                value={form.contatoNome}
                onChange={e => setForm(p => ({ ...p, contatoNome: e.target.value }))}
                placeholder="Quem é o tomador de decisão"
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value as ProspectStatus }))}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {(Object.entries(PROSPECT_STATUS_LABEL) as [ProspectStatus, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3" /> Telefone
              </label>
              <input
                value={form.telefone}
                onChange={e => setForm(p => ({ ...p, telefone: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Mail className="w-3 h-3" /> Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Último contato
              </label>
              <input
                type="date"
                value={form.ultimoContato}
                onChange={e => setForm(p => ({ ...p, ultimoContato: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Próximo contato
              </label>
              <input
                type="date"
                value={form.proximoContato}
                onChange={e => setForm(p => ({ ...p, proximoContato: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Observações
            </label>
            <textarea
              value={form.observacoes}
              onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))}
              rows={3}
              placeholder="Histórico, contexto, próximos passos..."
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 resize-y"
            />
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-border">
            {isEditing && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(prospect!.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Save className="w-3.5 h-3.5" /> {isEditing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProspectModal;
