import { useCRM } from '@/contexts/CRMContext';
import { calculateMetrics, formatCurrency } from '@/lib/crm-utils';
import { TrendingUp, Users, Target, DollarSign, BarChart3 } from 'lucide-react';

const KPICards = () => {
  const { deals } = useCRM();
  const metrics = calculateMetrics(deals);

  const cards = [
    { label: 'Total Leads', value: metrics.totalLeads.toString(), icon: Users, change: `${metrics.pipelineValue > 0 ? formatCurrency(metrics.pipelineValue) + ' em pipeline' : ''}`, accent: 'text-info' },
    { label: 'Deals Fechados', value: metrics.closedCount.toString(), icon: Target, change: `${metrics.lossRate.toFixed(1)}% perdidos`, accent: 'text-success' },
    { label: 'Taxa de Conversão', value: `${metrics.conversionRate.toFixed(1)}%`, icon: TrendingUp, change: 'do total de leads', accent: 'text-primary' },
    { label: 'Ticket Médio', value: formatCurrency(metrics.avgTicket), icon: BarChart3, change: 'por deal fechado', accent: 'text-stage-negotiation' },
    { label: 'Receita Total', value: formatCurrency(metrics.totalRevenue), icon: DollarSign, change: 'deals fechados', accent: 'text-success' },
  ];

  return (
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
  );
};

export default KPICards;
