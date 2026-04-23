import { useState, useEffect } from 'react';
import { Deal, Stage, ServiceType, LossReason, STAGES, LOSS_REASONS, SERVICE_TYPES } from '@/types/crm';
import { getStageConfig } from '@/lib/crm-utils';
import { useAuth } from '@/contexts/AuthContext';
import { X, Trash2, Save, MapPin, Phone, Calendar, User, Truck } from 'lucide-react';

interface DealModalProps {
  deal?: Deal | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => void | Promise<void>;
  onUpdate?: (id: string, updates: Partial<Deal>) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
}

const emptyForm = {
  nome: '', telefone: '', origem: '', destino: '', dataMudanca: '',
  tipoServico: 'completo' as ServiceType, valor: 0, stage: 'lead_novo' as Stage,
  parceiro: '', motivoPerda: undefined as LossReason | undefined,
};

const DealModal = ({ deal, isOpen, onClose, onSave, onUpdate, onDelete }: DealModalProps) => {
  const { isHead } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const isEditing = !!deal;

  useEffect(() => {
    if (deal) {
      setForm({ nome: deal.nome, telefone: deal.telefone, origem: deal.origem, destino: deal.destino, dataMudanca: deal.dataMudanca, tipoServico: deal.tipoServico, valor: deal.valor, stage: deal.stage, parceiro: deal.parceiro, motivoPerda: deal.motivoPerda });
    } else {
      setForm(emptyForm);
    }
  }, [deal]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing && onUpdate) {
      onUpdate(deal!.id, form);
    } else {
      onSave(form);
    }
    onClose();
  };

  const stageConfig = getStageConfig(form.stage);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-card-foreground">{isEditing ? 'Editar Deal' : 'Novo Deal'}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {isEditing && (
                <span className={`stage-badge ${stageConfig.bgColor} ${stageConfig.textColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${stageConfig.color}`} />
                  {stageConfig.label}
                </span>
              )}
              {isEditing && isHead && deal?.sellerName && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                  <User className="w-3 h-3" />
                  Vendedor: {deal.sellerName}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><User className="w-3 h-3" />Nome</label>
              <input required value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Phone className="w-3 h-3" />Telefone</label>
              <input required value={form.telefone} onChange={e => setForm(p => ({ ...p, telefone: e.target.value }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Origem</label>
              <input required value={form.origem} onChange={e => setForm(p => ({ ...p, origem: e.target.value }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Destino</label>
              <input required value={form.destino} onChange={e => setForm(p => ({ ...p, destino: e.target.value }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Data da Mudança</label>
              <input type="date" required value={form.dataMudanca} onChange={e => setForm(p => ({ ...p, dataMudanca: e.target.value }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1">Valor (R$)</label>
              <input type="number" required min={0} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: Number(e.target.value) }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Truck className="w-3 h-3" />Tipo de Serviço</label>
              <select value={form.tipoServico} onChange={e => setForm(p => ({ ...p, tipoServico: e.target.value as ServiceType }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                {Object.entries(SERVICE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1">Etapa</label>
              <select value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value as Stage }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1">Parceiro</label>
            <input value={form.parceiro} onChange={e => setForm(p => ({ ...p, parceiro: e.target.value }))} placeholder="Nome do parceiro (opcional)" className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50" />
          </div>

          {form.stage === 'perdido' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1">Motivo da Perda</label>
              <select value={form.motivoPerda || ''} onChange={e => setForm(p => ({ ...p, motivoPerda: e.target.value as LossReason }))} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Selecionar...</option>
                {Object.entries(LOSS_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-center gap-3 pt-3 border-t border-border">
            {isEditing && onDelete && (
              <button type="button" onClick={() => { onDelete(deal!.id); onClose(); }} className="flex items-center gap-1.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
              <Save className="w-3.5 h-3.5" /> {isEditing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DealModal;
