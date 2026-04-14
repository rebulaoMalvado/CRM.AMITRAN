import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Deal, Stage, Filters, SortField, SortDirection } from '@/types/crm';
import { mockDeals } from '@/data/mockDeals';

interface CRMContextType {
  deals: Deal[];
  filters: Filters;
  sortField: SortField;
  sortDirection: SortDirection;
  setFilters: (f: Filters) => void;
  setSortField: (f: SortField) => void;
  setSortDirection: (d: SortDirection) => void;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateDeal: (id: string, updates: Partial<Deal>) => void;
  deleteDeal: (id: string) => void;
  moveDeal: (id: string, newStage: Stage) => void;
  importDeals: (newDeals: Deal[]) => void;
  filteredDeals: Deal[];
  getDealsByStage: (stage: Stage) => Deal[];
}

const CRMContext = createContext<CRMContextType | null>(null);

const STORAGE_KEY = 'nog-crm-deals';

function loadDeals(): Deal[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return mockDeals;
}

function saveDeals(deals: Deal[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

export function CRMProvider({ children }: { children: React.ReactNode }) {
  const [deals, setDeals] = useState<Deal[]>(loadDeals);
  const [filters, setFilters] = useState<Filters>({});
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => { saveDeals(deals); }, [deals]);

  const addDeal = useCallback((deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    setDeals(prev => [...prev, { ...deal, id: crypto.randomUUID(), createdAt: now, updatedAt: now }]);
  }, []);

  const updateDeal = useCallback((id: string, updates: Partial<Deal>) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d));
  }, []);

  const deleteDeal = useCallback((id: string) => {
    setDeals(prev => prev.filter(d => d.id !== id));
  }, []);

  const moveDeal = useCallback((id: string, newStage: Stage) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage: newStage, updatedAt: new Date().toISOString() } : d));
  }, []);

  const importDeals = useCallback((newDeals: Deal[]) => {
    setDeals(newDeals);
  }, []);

  const filteredDeals = React.useMemo(() => {
    let result = [...deals];

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(d => d.nome.toLowerCase().includes(s) || d.origem.toLowerCase().includes(s) || d.destino.toLowerCase().includes(s));
    }
    if (filters.stage) result = result.filter(d => d.stage === filters.stage);
    if (filters.dateFrom) result = result.filter(d => d.createdAt >= filters.dateFrom!);
    if (filters.dateTo) result = result.filter(d => d.createdAt <= filters.dateTo!);
    if (filters.valueMin !== undefined) result = result.filter(d => d.valor >= filters.valueMin!);
    if (filters.valueMax !== undefined) result = result.filter(d => d.valor <= filters.valueMax!);

    result.sort((a, b) => {
      const aVal = sortField === 'valor' ? a.valor : new Date(a[sortField]).getTime();
      const bVal = sortField === 'valor' ? b.valor : new Date(b[sortField]).getTime();
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [deals, filters, sortField, sortDirection]);

  const getDealsByStage = useCallback((stage: Stage) => {
    return filteredDeals.filter(d => d.stage === stage);
  }, [filteredDeals]);

  return (
    <CRMContext.Provider value={{ deals, filters, sortField, sortDirection, setFilters, setSortField, setSortDirection, addDeal, updateDeal, deleteDeal, moveDeal, importDeals, filteredDeals, getDealsByStage }}>
      {children}
    </CRMContext.Provider>
  );
}

export function useCRM() {
  const ctx = useContext(CRMContext);
  if (!ctx) throw new Error('useCRM must be used within CRMProvider');
  return ctx;
}
