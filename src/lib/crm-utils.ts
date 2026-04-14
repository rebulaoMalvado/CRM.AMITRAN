import { Deal, STAGES, Stage } from '@/types/crm';

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function getStageConfig(stage: Stage) {
  return STAGES.find(s => s.id === stage)!;
}

export function isStuckDeal(deal: Deal): boolean {
  if (deal.stage === 'fechado' || deal.stage === 'perdido') return false;
  const lastUpdate = new Date(deal.updatedAt).getTime();
  const hoursSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60);
  return hoursSinceUpdate > 24;
}

export function isHotDeal(deal: Deal): boolean {
  return deal.valor >= 8000;
}

export function isNewDeal(deal: Deal): boolean {
  const created = new Date(deal.createdAt).getTime();
  const hoursSinceCreation = (Date.now() - created) / (1000 * 60 * 60);
  return hoursSinceCreation < 12;
}

export function calculateMetrics(deals: Deal[]) {
  const totalLeads = deals.length;
  const closedDeals = deals.filter(d => d.stage === 'fechado');
  const lostDeals = deals.filter(d => d.stage === 'perdido');
  const closedCount = closedDeals.length;
  const totalRevenue = closedDeals.reduce((sum, d) => sum + d.valor, 0);
  const avgTicket = closedCount > 0 ? totalRevenue / closedCount : 0;
  const conversionRate = totalLeads > 0 ? (closedCount / totalLeads) * 100 : 0;
  const lossRate = totalLeads > 0 ? (lostDeals.length / totalLeads) * 100 : 0;
  const pipelineValue = deals.filter(d => d.stage !== 'fechado' && d.stage !== 'perdido').reduce((sum, d) => sum + d.valor, 0);

  const stageDistribution = STAGES.map(s => ({
    name: s.label,
    value: deals.filter(d => d.stage === s.id).length,
    total: deals.filter(d => d.stage === s.id).reduce((sum, d) => sum + d.valor, 0),
  }));

  const funnelData = STAGES.filter(s => s.id !== 'perdido').map(s => ({
    name: s.label,
    value: deals.filter(d => d.stage === s.id).length,
  }));

  const lossReasons = lostDeals.reduce((acc, d) => {
    const reason = d.motivoPerda || 'outro';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return { totalLeads, closedCount, totalRevenue, avgTicket, conversionRate, lossRate, pipelineValue, stageDistribution, funnelData, lossReasons };
}
