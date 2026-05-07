import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CRMProvider, useCRM } from '@/contexts/CRMContext';
import { useAuth } from '@/contexts/AuthContext';
import { Deal, InstallmentWithDeal, InstallmentStatusFilter } from '@/types/crm';
import { fetchAllInstallmentsWithDeal } from '@/lib/installments';
import { formatCurrency } from '@/lib/crm-utils';
import DealModal from '@/components/crm/DealModal';
import { ArrowLeft, LogOut, Loader2, CheckCircle2, Clock, User, SlidersHorizontal, Wallet } from 'lucide-react';
import { toast } from 'sonner';

const formatDateBR = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ParcelasInner = () => {
  const { profile, isHead, signOut } = useAuth();
  const { deals, profiles, updateDeal, deleteDeal, addDeal } = useCRM();

  const [installments, setInstallments] = useState<InstallmentWithDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InstallmentStatusFilter>('todas');
  const [sellerFilter, setSellerFilter] = useState<string>('');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const profileMap = useMemo(() => {
    const map = new Map<string, typeof profiles[number]>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAllInstallmentsWithDeal(profileMap);
      setInstallments(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'desconhecido';
      toast.error('Erro ao carregar parcelas: ' + message);
    } finally {
      setLoading(false);
    }
  }, [profileMap]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sellers = useMemo(() => profiles.filter(p => p.role === 'vendedor'), [profiles]);

  const filtered = useMemo(() => {
    return installments.filter(i => {
      if (statusFilter === 'previstas' && i.isReceived) return false;
      if (statusFilter === 'recebidas' && !i.isReceived) return false;
      if (sellerFilter && i.dealSellerId !== sellerFilter) return false;
      return true;
    });
  }, [installments, statusFilter, sellerFilter]);

  const openDeal = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) {
      toast.error('Deal não encontrado');
      return;
    }
    setSelectedDeal(deal);
    setModalOpen(true);
  };

  const handleClose = () => {
    setModalOpen(false);
    refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Parcelas</h1>
              <p className="text-[11px] text-muted-foreground">{profile?.name} · {isHead ? 'Head de Vendas' : 'Vendedor'}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 space-y-4">
        <div className="filter-bar">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as InstallmentStatusFilter)}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="todas">Todas</option>
              <option value="previstas">Previstas</option>
              <option value="recebidas">Recebidas</option>
            </select>
          </div>

          {isHead && sellers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <User className="w-4 h-4 text-muted-foreground" />
              <select
                value={sellerFilter}
                onChange={e => setSellerFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todos vendedores</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-card-foreground">
              {filtered.length} parcela{filtered.length !== 1 ? 's' : ''}
            </h2>
          </div>

          {loading ? (
            <div className="p-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                    <th className="text-left px-4 py-2.5 font-medium">Parcela</th>
                    <th className="text-left px-4 py-2.5 font-medium">Valor previsto</th>
                    <th className="text-left px-4 py-2.5 font-medium">Vencimento</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Recebido</th>
                    {isHead && <th className="text-left px-4 py-2.5 font-medium">Vendedor</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(i => (
                    <tr
                      key={i.id}
                      className="border-t border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => openDeal(i.dealId)}
                    >
                      <td className="px-4 py-2.5 font-medium text-card-foreground">{i.dealNome}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        Parcela {i.installmentNumber}/{i.dealInstallmentsTotal}
                      </td>
                      <td className="px-4 py-2.5 text-card-foreground">{formatCurrency(i.amount)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDateBR(i.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        {i.isReceived ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-success/10 text-success">
                            <CheckCircle2 className="w-3 h-3" /> RECEBIDA
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-info/10 text-info">
                            <Clock className="w-3 h-3" /> PREVISTA
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {i.isReceived && i.receivedDate ? (
                          <span className="text-success font-medium">
                            {formatCurrency(Number(i.receivedAmount ?? i.amount))} · {formatDateBR(i.receivedDate)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {isHead && (
                        <td className="px-4 py-2.5 text-xs">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                            <User className="w-2.5 h-2.5" />
                            {i.dealSellerName || '—'}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={isHead ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground text-sm">
                        Nenhuma parcela encontrada com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Wallet className="w-3 h-3" />
          Clique em uma linha para abrir o deal e marcar/desfazer recebimento.
        </p>
      </main>

      <DealModal
        deal={selectedDeal}
        isOpen={modalOpen}
        onClose={handleClose}
        onSave={addDeal}
        onUpdate={updateDeal}
        onDelete={deleteDeal}
      />
    </div>
  );
};

const Parcelas = () => (
  <CRMProvider>
    <ParcelasInner />
  </CRMProvider>
);

export default Parcelas;
