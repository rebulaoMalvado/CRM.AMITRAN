import { useCRM } from '@/contexts/CRMContext';
import { calculateMetrics, formatCurrency } from '@/lib/crm-utils';
import { LOSS_REASONS } from '@/types/crm';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, FunnelChart, Funnel, LabelList,
} from 'recharts';

const COLORS = ['hsl(220,70%,55%)', 'hsl(35,92%,50%)', 'hsl(190,72%,45%)', 'hsl(280,60%,55%)', 'hsl(145,63%,42%)', 'hsl(0,72%,51%)'];

const Charts = () => {
  const { deals } = useCRM();
  const metrics = calculateMetrics(deals);

  const lossData = Object.entries(metrics.lossReasons).map(([key, value]) => ({
    name: LOSS_REASONS[key as keyof typeof LOSS_REASONS] || key,
    value,
  }));

  // Revenue over time (grouped by creation week)
  const revenueByDay = deals
    .filter(d => d.stage === 'fechado')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .reduce((acc, d) => {
      const date = d.createdAt.split('T')[0];
      const existing = acc.find(a => a.date === date);
      if (existing) existing.receita += d.valor;
      else acc.push({ date, receita: d.valor });
      return acc;
    }, [] as { date: string; receita: number }[]);

  const tooltipStyle = {
    contentStyle: { backgroundColor: 'hsl(228,18%,11%)', border: '1px solid hsl(228,14%,18%)', borderRadius: '8px', color: 'hsl(210,20%,95%)' },
    itemStyle: { color: 'hsl(210,20%,95%)' },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Funnel Chart */}
      <div className="chart-container">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">Funil de Conversão</h3>
        <ResponsiveContainer width="100%" height={250}>
          <FunnelChart>
            <Tooltip {...tooltipStyle} />
            <Funnel dataKey="value" data={metrics.funnelData} isAnimationActive>
              {metrics.funnelData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
              <LabelList position="right" fill="hsl(210,20%,95%)" stroke="none" dataKey="name" fontSize={11} />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue Line */}
      <div className="chart-container">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">Receita ao Longo do Tempo</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={revenueByDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(228,14%,18%)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(220,9%,46%)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(220,9%,46%)' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
            <Line type="monotone" dataKey="receita" stroke="hsl(145,63%,42%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(145,63%,42%)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Loss Reasons Pie */}
      <div className="chart-container">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">Motivos de Perda</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={lossData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
              {lossData.map((_, i) => (
                <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Stage Distribution Bar */}
      <div className="chart-container">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">Distribuição por Etapa</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={metrics.stageDistribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(228,14%,18%)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(220,9%,46%)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(220,9%,46%)' }} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {metrics.stageDistribution.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Charts;
