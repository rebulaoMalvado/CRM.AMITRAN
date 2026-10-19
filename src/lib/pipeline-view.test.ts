import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types/crm';
import { visibleDeals } from './pipeline-view';

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }) as Deal);

describe('visibleDeals', () => {
  it('mostra tudo quando cabe no limite', () => {
    const deals = mk(5);
    expect(visibleDeals(deals, 30, new Set())).toBe(deals);
  });
  it('corta no limite e mantém a ordem', () => {
    expect(visibleDeals(mk(100), 30, new Set()).map(d => d.id)).toEqual(mk(30).map(d => d.id));
  });
  it('mantém à vista os cards recém-movidos que estariam escondidos', () => {
    const ids = visibleDeals(mk(100), 3, new Set(['d50', 'd1'])).map(d => d.id);
    expect(ids).toEqual(['d0', 'd1', 'd2', 'd50']);
  });
});
