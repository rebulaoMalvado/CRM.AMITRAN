import { useMemo, useState } from 'react';
import { useCRM } from '@/contexts/CRMContext';
import { calculateMetrics, formatCurrency } from '@/lib/crm-utils';
import { Deal } from '@/types/crm';
import { TrendingUp, Users, Target, DollarSign, BarChart3, CalendarDays } from 'lucide-react';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthKey = (y: number, m: number) => `${y}-${pad2(m + 1)}`;

interface MonthOption {
  key: string; // 'all' | 'YYYY-MM'
  label: string;
}

/** Lista de opções: "Tudo" no topo + todos os meses entre o mês atual e
 *  max(mês mais antigo com lead, 12 meses atrás) — i.e., a janela menor. */
function buildMonthOptions(deals: Deal[]): MonthOption[] {
  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = now.getMonth();

  let oldest: Date | null = null;
  for (const d of deals) {
    const dt = new Date(d.createdAt);
    if (!oldest || dt < oldest) oldest = dt;
  }

  const twelveMonthsAgo = new Date(currentY, currentM - 11, 1);
  let earliest = twelveMonthsAgo;
  if (oldest) {
    const oldestStart = new Date(oldest.getFullYear(), oldest.getMonth(), 1);
    if (oldestStart > twelveMonthsAgo) earliest = oldestStart;
  }

  const months: MonthOption[] = [{ key: 'all', label: 'Tudo' }];
  let y = currentY;
  let m = currentM;
  while (y > earliest.getFullYear() || (y === earliest.getFullYear() && m >= earliest.getMonth())) {
    months.push({ key: monthKey(y, m), label: `${MONTH_LABELS[m]} ${y}` });
    if (m === 0) { y -= 1; m = 11; } else { m -= 1; }
  }
  return months;
}

const KPICards = () => {
  const { deals } = useCRM();
  const [selectedMonth, setSelectedMonth] = useState<string>(() => monthKey(new Date().getFullYear(), new Date().getMonth()));

  const monthOptions = useMemo(() => buildMonthOptions(deals), [deals]);

  // Garante que a opção selecionada existe na lista (caso o mês default seja
  // anterior ao primeiro lead, "Tudo" cai como fallback razoável).
  const effectiveMonth = useMemo(() => {
    if (monthOptions.some(o => o.key === selectedMonth)) return selectedMonth;
    return 'all';
  }, [monthOptions, selectedMonth]);

  const filteredDeals = useMemo(() => {
    if (effectiveMonth === 'all') return deals;
    const [yy, mm] = effectiveMonth.split('-').map(Number);
    const start = new Date(yy, mm - 1, 1).toISOString();
    const end = new Date(yy, mm, 1).toISOString();
    return deals.filter(d => d.createdAt >= start && d.createdAt < end);
  }, [deals, effectiveMonth]);

  const monthMetrics = useMemo(() => calculateMetrics(filteredDeals), [filteredDeals]);
  const globalMetrics = useMemo(() => calculateMetrics(deals), [deals]);

  const selectedLabel = monthOptions.find(o => o.key === effectiveMonth)?.label;
  const isFiltered = effectiveMonth !== 'all';

  const totalLeadsSubtitle = globalMetrics.pipelineValue > 0
    ? `${formatCurrency(globalMetrics.pipelineValue)} em pipeline`
    : '';

  const fechadosSubtitle = monthMetrics.totalLeads > 0
    ? `${monthMetrics.lossRate.toFixed(1)}% perdidos`
    : '—';

  const conversaoValue = monthMetrics.totalLeads > 0
    ? `${monthMetrics.conversionRate.toFixed(1)}%`
    : '—';

  const ticketValue = monthMetrics.closedCount > 0
    ? formatCurrency(monthMetrics.avgTicket)
    : '—';

  const receitaSubtitle = `${monthMetrics.closedCount} deal${monthMetrics.closedCount === 1 ? '' : 's'} fechado${monthMetrics.closedCount === 1 ? '' : 's'}`;

  const cards = [
    { label: 'Total Leads', value: monthMetrics.totalLeads.toString(), icon: Users, change: totalLeadsSubtitle, accent: 'text-info' },
    { label: 'Deals Fechados', value: monthMetrics.closedCount.toString(), icon: Target, change: fechadosSubtitle, accent: 'text-success' },
    { label: 'Taxa de Conversão', value: conversaoValue, icon: TrendingUp, change: 'do total de leads', accent: 'text-primary' },
    { label: 'Ticket Médio', value: ticketValue, icon: BarChart3, change: 'por deal fechado', accent: 'text-stage-negotiation' },
    { label: 'Receita Total', value: formatCurrency(monthMetrics.totalRevenue), icon: DollarSign, change: receitaSubtitle, accent: 'text-success' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1.5 min-h-[28px]">
          {isFiltered && (
            <>
              <CalendarDays className="w-3.5 h-3.5" />
              Mostrando: <span className="text-card-foreground font-semibold">{selectedLabel}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <select
            value={effectiveMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 text-xs bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {monthOptions.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card, i) => (
          <div key={card.label} className="kpi-card animate-fade-in" style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'both' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{card.label}</span>
              <card.icon className={`w-4 h-4 ${card.accent}`} />
            </div>
            <div className="text-2xl font-bold text-card-foreground">{card.value}</div>
            <p className="text-xs text-muted-foreground mt-1">{card.change}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KPICards;
