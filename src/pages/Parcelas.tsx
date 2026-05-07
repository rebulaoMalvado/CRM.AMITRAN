import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CRMProvider, useCRM } from '@/contexts/CRMContext';
import { useAuth } from '@/contexts/AuthContext';
import { Deal, InstallmentWithDeal, InstallmentStatusFilter } from '@/types/crm';
import { fetchAllInstallmentsWithDeal } from '@/lib/installments';
import DealModal from '@/components/crm/DealModal';
import InstallmentsTable from '@/components/crm/InstallmentsTable';
import { ArrowLeft, LogOut, User, SlidersHorizontal, Wallet } from 'lucide-react';
import { toast } from 'sonner';

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

  const openDeal = (installment: InstallmentWithDeal) => {
    const deal = deals.find(d => d.id === installment.dealId);
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

          <InstallmentsTable
            installments={filtered}
            loading={loading}
            isHead={isHead}
            onRowClick={openDeal}
          />
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
