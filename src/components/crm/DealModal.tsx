import { useState, useEffect, useMemo } from 'react';
import { Deal, Stage, ServiceType, LossReason, DealInstallmentDraft, STAGES, LOSS_REASONS, SERVICE_TYPES } from '@/types/crm';
import { getStageConfig, formatCurrency } from '@/lib/crm-utils';
import { fetchInstallmentsByDeal, saveInstallments, markInstallmentReceived, unmarkInstallmentReceived } from '@/lib/installments';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { X, Trash2, Save, MapPin, Phone, Calendar, User, Truck, Plus, Wallet, CheckCircle2, Undo2, FileText } from 'lucide-react';
import PropostaModal from './PropostaModal';

const PROPOSTA_STAGES: Stage[] = ['orcamento_enviado', 'negociacao', 'fechado'];

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

const formatDateBR = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

type ReceiptForm = { idx: number; date: string; amount: number };

const DealModal = ({ deal, isOpen, onClose, onSave, onUpdate, onDelete }: DealModalProps) => {
  const { isHead } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [installments, setInstallments] = useState<DealInstallmentDraft[]>([]);
  const [deletedInstallmentIds, setDeletedInstallmentIds] = useState<string[]>([]);
  const [installmentsLoaded, setInstallmentsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm | null>(null);
  const [undoIdx, setUndoIdx] = useState<number | null>(null);
  const [showProposta, setShowProposta] = useState(false);
  const isEditing = !!deal;
  const showInstallments = isEditing && form.stage === 'fechado';
  const canGerarProposta = isEditing && PROPOSTA_STAGES.includes(form.stage);

  useEffect(() => {
    if (deal) {
      setForm({ nome: deal.nome, telefone: deal.telefone, origem: deal.origem, destino: deal.destino, dataMudanca: deal.dataMudanca, tipoServico: deal.tipoServico, valor: deal.valor, stage: deal.stage, parceiro: deal.parceiro, motivoPerda: deal.motivoPerda });
    } else {
      setForm(emptyForm);
    }
    setInstallments([]);
    setDeletedInstallmentIds([]);
    setInstallmentsLoaded(false);
    setReceiptForm(null);
    setUndoIdx(null);
  }, [deal]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInstallments, installmentsLoaded]);

  const installmentsSum = useMemo(
    () => installments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
    [installments]
  );
  const totalReceived = useMemo(
    () => installments.reduce((sum, i) => sum + (i.isReceived ? Number(i.receivedAmount ?? i.amount) || 0 : 0), 0),
    [installments]
  );
  const totalOpen = installmentsSum - totalReceived;
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
    setReceiptForm(prev => (prev && prev.idx === idx ? null : prev));
    setUndoIdx(prev => (prev === idx ? null : prev));
  };

  const openReceiptForm = (idx: number) => {
    const it = installments[idx];
    setUndoIdx(null);
    setReceiptForm({ idx, date: todayISO(), amount: it.amount });
  };

  const confirmReceipt = async () => {
    if (!receiptForm) return;
    const target = installments[receiptForm.idx];
    if (!target?.id) return;
    try {
      const updated = await markInstallmentReceived(target.id, receiptForm.date, receiptForm.amount);
      setInstallments(prev => prev.map((it, i) => (
        i === receiptForm.idx
          ? { ...it, isReceived: true, receivedDate: updated.receivedDate, receivedAmount: updated.receivedAmount }
          : it
      )));
      setReceiptForm(null);
      toast.success('Parcela marcada como recebida');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'desconhecido';
      toast.error('Erro ao marcar recebimento: ' + message);
    }
  };

  const confirmUndo = async (idx: number) => {
    const target = installments[idx];
    if (!target?.id) return;
    try {
      await unmarkInstallmentReceived(target.id);
      setInstallments(prev => prev.map((it, i) => (
        i === idx
          ? { ...it, isReceived: false, receivedDate: undefined, receivedAmount: undefined }
          : it
      )));
      setUndoIdx(null);
      toast.success('Recebimento desfeito');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'desconhecido';
      toast.error('Erro ao desfazer: ' + message);
    }
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
                {installments.map((it, idx) => {
                  const received = it.isReceived;
                  const containerCls = received
                    ? 'border border-success/40 bg-success/5 rounded-lg p-2.5 space-y-2'
                    : 'rounded-lg p-2.5 space-y-2';
                  const isReceiptOpen = receiptForm?.idx === idx;
                  const isUndoOpen = undoIdx === idx;

                  return (
                    <div key={it.id ?? `new-${idx}`} className={containerCls}>
                      <div className="flex items-end gap-2">
                        <div className="w-20 shrink-0">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Parcela {idx + 1}
                          </label>
                          <div className={`px-3 py-2 text-sm rounded-lg text-center flex items-center justify-center gap-1 ${received ? 'bg-success/15 text-success font-semibold' : 'bg-muted/50 border border-border text-muted-foreground'}`}>
                            {received && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {idx + 1}
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor (R$)</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it.amount}
                            onChange={e => updateInstallment(idx, { amount: Number(e.target.value) })}
                            disabled={received}
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Vencimento</label>
                          <input
                            type="date"
                            value={it.dueDate}
                            onChange={e => updateInstallment(idx, { dueDate: e.target.value })}
                            required
                            disabled={received}
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60 disabled:cursor-not-allowed"
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

                      {received && it.receivedDate && (
                        <div className="text-xs text-success font-medium pl-1">
                          Recebido em {formatDateBR(it.receivedDate)} — {formatCurrency(Number(it.receivedAmount ?? it.amount))}
                        </div>
                      )}

                      {it.id && !received && !isReceiptOpen && (
                        <button
                          type="button"
                          onClick={() => openReceiptForm(idx)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-success bg-success/10 hover:bg-success/20 rounded transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Marcar como recebida
                        </button>
                      )}

                      {it.id && received && !isUndoOpen && (
                        <button
                          type="button"
                          onClick={() => { setReceiptForm(null); setUndoIdx(idx); }}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-card-foreground bg-muted hover:bg-accent rounded transition-colors"
                        >
                          <Undo2 className="w-3 h-3" /> Desfazer recebimento
                        </button>
                      )}

                      {isReceiptOpen && receiptForm && (
                        <div className="bg-card border border-success/30 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-semibold text-card-foreground">Confirmar recebimento</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] text-muted-foreground mb-1 block">Data do recebimento</label>
                              <input
                                type="date"
                                value={receiptForm.date}
                                onChange={e => setReceiptForm({ ...receiptForm, date: e.target.value })}
                                className="w-full px-2.5 py-1.5 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-success/50"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground mb-1 block">Valor recebido (R$)</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={receiptForm.amount}
                                onChange={e => setReceiptForm({ ...receiptForm, amount: Number(e.target.value) })}
                                className="w-full px-2.5 py-1.5 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-success/50"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={confirmReceipt}
                              className="px-3 py-1.5 text-xs font-medium bg-success text-success-foreground rounded hover:opacity-90 transition-opacity"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setReceiptForm(null)}
                              className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {isUndoOpen && (
                        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
                          <div className="text-xs text-card-foreground">
                            Desfazer o recebimento desta parcela? Os valores reais serão apagados.
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => confirmUndo(idx)}
                              className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded hover:opacity-90 transition-opacity"
                            >
                              Desfazer
                            </button>
                            <button
                              type="button"
                              onClick={() => setUndoIdx(null)}
                              className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={addInstallment}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar parcela
              </button>

              <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>Total previsto: <strong className="text-card-foreground">{formatCurrency(installmentsSum)}</strong></span>
                <span>Total recebido: <strong className="text-success">{formatCurrency(totalReceived)}</strong></span>
                <span>Em aberto: <strong className="text-card-foreground">{formatCurrency(totalOpen)}</strong></span>
              </div>

              {sumMismatch && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  Soma das parcelas: {formatCurrency(installmentsSum)}. Valor do contrato: {formatCurrency(form.valor)}. Diferença: {formatCurrency(Math.abs(installmentsSum - form.valor))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-3 border-t border-border flex-wrap">
            {isEditing && onDelete && (
              <button type="button" onClick={() => { onDelete(deal!.id); onClose(); }} className="flex items-center gap-1.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
            )}
            {canGerarProposta && (
              <button
                type="button"
                onClick={() => setShowProposta(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> Gerar Proposta
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
      {canGerarProposta && deal && (
        <PropostaModal
          deal={deal}
          isOpen={showProposta}
          onClose={() => setShowProposta(false)}
        />
      )}
    </div>
  );
};

export default DealModal;
