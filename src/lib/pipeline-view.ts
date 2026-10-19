import type { Deal } from '@/types/crm';

/** Quantos cards cada coluna do pipeline mostra de início (e a cada "Mostrar mais"). */
export const PAGE_SIZE = 30;

/**
 * Escolhe quais cards a coluna desenha. Colunas com centenas de cards (ex.: "Perdido") deixavam o
 * arrastar travado, então só desenhamos os primeiros `limit`. Cards que a pessoa acabou de mover
 * ficam sempre à vista (`pinnedIds`), senão sumiriam no meio dos escondidos.
 */
export function visibleDeals(deals: Deal[], limit: number, pinnedIds: ReadonlySet<string>): Deal[] {
  if (deals.length <= limit) return deals;
  return deals.filter((d, i) => i < limit || pinnedIds.has(d.id));
}
