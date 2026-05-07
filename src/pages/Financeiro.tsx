import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CRMProvider, useCRM } from '@/contexts/CRMContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Deal, InstallmentWithDeal } from '@/types/crm';
import {
  fetchInstallmentsByDueDateRange,
  fetchOpenInstallmentsUntil,
  fetchReceivedInstallmentsInRange,
} from '@/lib/installments';
import { formatCurrency } from '@/lib/crm-utils';
import DealModal from '@/components/crm/DealModal';
import InstallmentsTable from '@/components/crm/InstallmentsTable';
import FinanceiroCalendar from '@/components/crm/FinanceiroCalendar';
import {
  ArrowLeft, LogOut, Loader2, ChevronLeft, ChevronRight,
  Wallet, TrendingUp, Clock, CalendarDays, List, CheckCircle2, X,
} from 'lucide-react';
import { toast } from 'sonner';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDateBR = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const localISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

interface MonthKPIs {
  vendas: { total: number; count: number };
  entradas: { total: number; count: number };
  emAberto: { total: number; count: number };
}

type ViewMode = 'calendario' | 'lista';

const FinanceiroInner = () => {
  const { profile, isHead, signOut } = useAuth();
  const { deals, profiles, updateDeal, deleteDeal, addDeal } = useCRM();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [mode, setMode] = useState<ViewMode>('calendario');
  const [installments, setInstallments] = useState<InstallmentWithDeal[]>([]);
  const [kpis, setKpis] = useState<MonthKPIs>({
    vendas: { total: 0, count: 0 },
    entradas: { total: 0, count: 0 },
    emAberto: { total: 0, count: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [selectedDayISO, setSelectedDayISO] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const profileMap = useMemo(() => {
    const map = new Map<string, typeof profiles[number]>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const monthLabel = `${MONTH_LABELS[month]} ${year}`;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const monthStartISO = localISO(new Date(year, month, 1));
      const monthEndISO = localISO(new Date(year, month + 1, 0));
      const closedFromTs = new Date(year, month, 1).toISOString();
      const closedToTs = new Date(year, month + 1, 1).toISOString();

      const dealsClosedQ = supabase
        .from('deals')
        .select('id, valor')
        .eq('stage', 'fechado')
        .gte('closed_at', closedFromTs)
        .lt('closed_at', closedToTs);

      const [
        installmentsRes,
        dealsClosedRes,
        entradasRes,
        emAbertoRes,
      ] = await Promise.all([
        fetchInstallmentsByDueDateRange(monthStartISO, monthEndISO, profileMap),
        dealsClosedQ,
        fetchReceivedInstallmentsInRange(monthStartISO, monthEndISO),
        fetchOpenInstallmentsUntil(monthEndISO),
      ]);

      if (dealsClosedRes.error) throw dealsClosedRes.error;
      const dealsClosed = (dealsClosedRes.data || []) as { id: string; valor: number | string | null }[];
      const vendasTotal = dealsClosed.reduce((s, d) => s + (Number(d.valor) || 0), 0);

      setInstallments(installmentsRes);
      setKpis({
        vendas: { total: vendasTotal, count: dealsClosed.length },
        entradas: entradasRes,
        emAberto: emAbertoRes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'desconhecido';
      toast.error('Erro ao carregar financeiro: ' + message);
    } finally {
      setLoading(false);
    }
  }, [year, month, profileMap]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Limpa o dia selecionado ao trocar de mês
  useEffect(() => {
    setSelectedDayISO(null);
  }, [year, month]);

  const goPrevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
  };

  const goNextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
  };

  const openDealById = (dealId: string) => {
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

  const selectedDayInstallments = useMemo(() => {
    if (!selectedDayISO) return [];
    return installments.filter(i => i.dueDate === selectedDayISO);
  }, [installments, selectedDayISO]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Financeiro</h1>
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
        {/* Mês nav */}
        <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
          <button
            onClick={goPrevMonth}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Mês anterior
          </button>
          <h2 className="text-base font-bold text-card-foreground capitalize">{monthLabel}</h2>
          <button
            onClick={goNextMonth}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            Mês seguinte <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="kpi-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vendas do mês</span>
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(kpis.vendas.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis.vendas.count} deal{kpis.vendas.count !== 1 ? 's' : ''} fechado{kpis.vendas.count !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="kpi-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Entradas do mês</span>
              <CheckCircle2 className="w-4 h-4 text-success" />
            </div>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(kpis.entradas.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis.entradas.count} parcela{kpis.entradas.count !== 1 ? 's' : ''} recebida{kpis.entradas.count !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="kpi-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Em aberto</span>
              <Clock className="w-4 h-4 text-warning" />
            </div>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(kpis.emAberto.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis.emAberto.count} parcela{kpis.emAberto.count !== 1 ? 's' : ''} até o fim do mês
            </p>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('calendario')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'calendario' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent'}`}
          >
            <CalendarDays className="w-3.5 h-3.5" /> Calendário
          </button>
          <button
            onClick={() => setMode('lista')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'lista' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent'}`}
          >
            <List className="w-3.5 h-3.5" /> Lista
          </button>
        </div>

        {loading ? (
          <div className="bg-card border border-border rounded-xl p-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : mode === 'calendario' ? (
          <>
            <FinanceiroCalendar
              year={year}
              month={month}
              installments={installments}
              selectedDayISO={selectedDayISO}
              onDayClick={iso => setSelectedDayISO(prev => (prev === iso ? null : iso))}
            />

            {selectedDayISO && selectedDayInstallments.length > 0 && (
              <section className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-card-foreground">
                    Parcelas em {formatDateBR(selectedDayISO)}
                  </h3>
                  <button
                    onClick={() => setSelectedDayISO(null)}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                    title="Fechar"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <ul className="divide-y divide-border">
                  {selectedDayInstallments.map(i => (
                    <li
                      key={i.id}
                      onClick={() => openDealById(i.dealId)}
                      className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-card-foreground truncate">{i.dealNome}</div>
                        <div className="text-xs text-muted-foreground">
                          Parcela {i.installmentNumber}/{i.dealInstallmentsTotal} · {formatCurrency(i.amount)}
                        </div>
                      </div>
                      {i.isReceived ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-success/10 text-success">
                          <CheckCircle2 className="w-3 h-3" /> RECEBIDA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-info/10 text-info">
                          <Clock className="w-3 h-3" /> PREVISTA
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <section className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-card-foreground">
                {installments.length} parcela{installments.length !== 1 ? 's' : ''} em {monthLabel.toLowerCase()}
              </h3>
            </div>
            <InstallmentsTable
              installments={installments}
              isHead={isHead}
              onRowClick={i => openDealById(i.dealId)}
              emptyMessage="Nenhuma parcela com vencimento neste mês."
            />
          </section>
        )}

        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Wallet className="w-3 h-3" />
          Vendas usam <code>closed_at</code>, entradas usam <code>received_date</code>; em aberto considera tudo até o fim do mês visualizado.
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

const Financeiro = () => (
  <CRMProvider>
    <FinanceiroInner />
  </CRMProvider>
);

export default Financeiro;
