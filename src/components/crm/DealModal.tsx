import { useState, useEffect, useMemo } from 'react';
import { Deal, Stage, ServiceType, LossReason, DealInstallmentDraft, STAGES, LOSS_REASONS, SERVICE_TYPES } from '@/types/crm';
import { getStageConfig, formatCurrency } from '@/lib/crm-utils';
import { fetchInstallmentsByDeal, saveInstallments } from '@/lib/installments';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { X, Trash2, Save, MapPin, Phone, Calendar, User, Truck, Plus, Wallet } from 'lucide-react';

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

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DealModal = ({ deal, isOpen, onClose, onSave, onUpdate, onDelete }: DealModalProps) => {
  const { isHead } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [installments, setInstallments] = useState<DealInstallmentDraft[]>([]);
  const [deletedInstallmentIds, setDeletedInstallmentIds] = useState<string[]>([]);
  const [installmentsLoaded, setInstallmentsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!deal;
  const showInstallments = isEditing && form.stage === 'fechado';

  useEffect(() => {
    if (deal) {
      setForm({ nome: deal.nome, telefone: deal.telefone, origem: deal.origem, destino: deal.destino, dataMudanca: deal.dataMudanca, tipoServico: deal.tipoServico, valor: deal.valor, stage: deal.stage, parceiro: deal.parceiro, motivoPerda: deal.motivoPerda });
    } else {
      setForm(emptyForm);
    }
    setInstallments([]);
    setDeletedInstallmentIds([]);
    setInstallmentsLoaded(false);
  }, [deal]);

  // Carrega parcelas existentes quando o modal abre pra um deal existente
  useEffect(() => {
    if (!isOpen || !deal) return;
    let cancelled = false;
    fetchInstallmentsByDeal(deal.id)
      .then(rows => {
        if (cancelled) return;
        setInstallments(rows.map(r => ({
          id: r.id,
          installmentNumber: r.installmentNumber,
          amount: r.amount,
          dueDate: r.dueDate,
          isReceived: r.isReceived,
          receivedDate: r.receivedDate,
          receivedAmount: r.receivedAmount,
        })));
        setInstallmentsLoaded(true);
      })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'desconhecido';
        toast.error('Erro ao carregar parcelas: ' + message);
        setInstallmentsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isOpen, deal]);

  // Cria 1 parcela default quando o deal vira "fechado" e ainda não tem parcela
  useEffect(() => {
    if (!showInstallments || !installmentsLoaded) return;
    setInstallments(prev => {
      if (prev.length > 0) return prev;
      return [{
        installmentNumber: 1,
        amount: form.valor,
        dueDate: todayISO(),
        isReceived: false,
      }];
    });
    // form.valor não é dep de propósito: o default usa o valor vigente no momento da criação
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInstallments, installmentsLoaded]);

  const installmentsSum = useMemo(
    () => installments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
    [installments]
  );
  const sumMismatch = Math.abs(installmentsSum - form.valor) >= 0.005;
  const installmentsInvalid = showInstallments && sumMismatch;

  if (!isOpen) return null;

  const updateInstallment = (idx: number, patch: Partial<DealInstallmentDraft>) => {
    setInstallments(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addInstallment = () => {
    setInstallments(prev => [
      ...prev,
      {
        installmentNumber: prev.length + 1,
        amount: 0,
        dueDate: todayISO(),
        isReceived: false,
      },
    ]);
  };

  const removeInstallment = (idx: number) => {
    setInstallments(prev => {
      if (prev.length <= 1) return prev;
      const target = prev[idx];
      if (target.id) {
        setDeletedInstallmentIds(d => [...d, target.id!]);
      }
      return prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, installmentNumber: i + 1 }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (installmentsInvalid) return;
    setSubmitting(true);
    try {
      if (isEditing && onUpdate) {
        await onUpdate(deal!.id, form);
        if (showInstallments) {
          try {
            await saveInstallments(deal!.id, installments, deletedInstallmentIds);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'desconhecido';
            toast.error('Erro ao salvar parcelas: ' + message);
            setSubmitting(false);
            return;
          }
        }
      } else {
        await onSave(form);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
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

          {showInstallments && (
            <div className="pt-3 border-t border-border space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-card-foreground">Parcelas de Pagamento</h3>
              </div>

              <div className="space-y-2">
                {installments.map((it, idx) => (
                  <div key={it.id ?? `new-${idx}`} className="flex items-end gap-2">
                    <div className="w-20 shrink-0">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Parcela {idx + 1}</label>
                      <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-muted-foreground text-center">{idx + 1}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.amount}
                        onChange={e => updateInstallment(idx, { amount: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Vencimento</label>
                      <input
                        type="date"
                        value={it.dueDate}
                        onChange={e => updateInstallment(idx, { dueDate: e.target.value })}
                        required
                        className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeInstallment(idx)}
                      disabled={installments.length <= 1}
                      title={installments.length <= 1 ? 'Mínimo 1 parcela' : 'Remover parcela'}
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addInstallment}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar parcela
              </button>

              {sumMismatch && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  Soma das parcelas: {formatCurrency(installmentsSum)}. Valor do contrato: {formatCurrency(form.valor)}. Diferença: {formatCurrency(Math.abs(installmentsSum - form.valor))}
                </div>
              )}
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
            <button
              type="submit"
              disabled={installmentsInvalid || submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" /> {isEditing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DealModal;
