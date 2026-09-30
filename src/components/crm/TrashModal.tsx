import { useEffect, useState } from 'react';
import { Deal, STAGES } from '@/types/crm';
import { useCRM } from '@/contexts/CRMContext';
import { formatCurrency } from '@/lib/crm-utils';
import { X, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const stageLabel = (id: Deal['stage']) => STAGES.find(s => s.id === id)?.label || id;

const formatDateTimeBR = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const TrashModal = ({ isOpen, onClose }: TrashModalProps) => {
  const { fetchDeletedDeals, restoreDeal, purgeDeal } = useCRM();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setConfirmPurgeId(null);
    fetchDeletedDeals().then(rows => {
      if (!cancelled) {
        setDeals(rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, fetchDeletedDeals]);

  if (!isOpen) return null;

  const handleRestore = async (id: string) => {
    setBusyId(id);
    await restoreDeal(id);
    setDeals(prev => prev.filter(d => d.id !== id));
    setBusyId(null);
  };

  const handlePurge = async (id: string) => {
    setBusyId(id);
    await purgeDeal(id);
    setDeals(prev => prev.filter(d => d.id !== id));
    setConfirmPurgeId(null);
    setBusyId(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-bold text-card-foreground">Lixeira</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Deals excluídos — restaure os que foram apagados sem querer.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="p-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : deals.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              A lixeira está vazia. 🗑️
            </div>
          ) : (
            deals.map(d => (
              <div key={d.id} className="border border-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-card-foreground truncate">{d.nome || '(sem nome)'}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {stageLabel(d.stage)} · {formatCurrency(d.valor)}
                    {d.sellerName ? ` · ${d.sellerName}` : ''}
                  </div>
                  <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Excluído em {formatDateTimeBR(d.deletedAt)}
                  </div>
                </div>
                {confirmPurgeId === d.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-destructive">Excluir de vez?</span>
                    <button
                      onClick={() => handlePurge(d.id)}
                      disabled={busyId === d.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Sim
                    </button>
                    <button
                      onClick={() => setConfirmPurgeId(null)}
                      className="px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(d.id)}
                      disabled={busyId === d.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Restaurar
                    </button>
                    <button
                      onClick={() => setConfirmPurgeId(d.id)}
                      disabled={busyId === d.id}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Excluir definitivamente"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const TrashButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
        title="Lixeira — deals excluídos"
      >
        <Undo2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Lixeira</span>
      </button>
      <TrashModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default TrashModal;
