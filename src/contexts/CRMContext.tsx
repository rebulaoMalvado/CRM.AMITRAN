import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Deal, Stage, Filters, SortField, SortDirection, Profile } from '@/types/crm';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

interface CRMContextType {
  deals: Deal[];
  profiles: Profile[];
  loading: boolean;
  filters: Filters;
  sortField: SortField;
  sortDirection: SortDirection;
  setFilters: (f: Filters) => void;
  setSortField: (f: SortField) => void;
  setSortDirection: (d: SortDirection) => void;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => Promise<void>;
  updateDeal: (id: string, updates: Partial<Deal>) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;
  moveDeal: (id: string, newStage: Stage) => Promise<void>;
  importDeals: (newDeals: Omit<Deal, 'id' | 'sellerId' | 'sellerName' | 'updatedAt'>[]) => Promise<void>;
  filteredDeals: Deal[];
  getDealsByStage: (stage: Stage) => Deal[];
  refresh: () => Promise<void>;
}

const CRMContext = createContext<CRMContextType | null>(null);

// DB row (snake_case) → TS Deal (camelCase)
type DealRow = {
  id: string;
  seller_id: string;
  nome: string;
  telefone: string | null;
  origem: string | null;
  destino: string | null;
  data_mudanca: string | null;
  tipo_servico: Deal['tipoServico'] | null;
  valor: number | null;
  stage: Deal['stage'];
  parceiro: string | null;
  motivo_perda: Deal['motivoPerda'] | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToDeal(row: DealRow, profileMap: Map<string, Profile>): Deal {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: profileMap.get(row.seller_id)?.name,
    nome: row.nome,
    telefone: row.telefone || '',
    origem: row.origem || '',
    destino: row.destino || '',
    dataMudanca: row.data_mudanca || '',
    tipoServico: row.tipo_servico || 'completo',
    valor: Number(row.valor) || 0,
    stage: row.stage,
    parceiro: row.parceiro || '',
    motivoPerda: row.motivo_perda || undefined,
    closedAt: row.closed_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dealToRow(deal: Partial<Deal>): Partial<DealRow> {
  const row: Partial<DealRow> = {};
  if (deal.sellerId !== undefined) row.seller_id = deal.sellerId;
  if (deal.nome !== undefined) row.nome = deal.nome;
  if (deal.telefone !== undefined) row.telefone = deal.telefone;
  if (deal.origem !== undefined) row.origem = deal.origem;
  if (deal.destino !== undefined) row.destino = deal.destino;
  if (deal.dataMudanca !== undefined) row.data_mudanca = deal.dataMudanca || null;
  if (deal.tipoServico !== undefined) row.tipo_servico = deal.tipoServico;
  if (deal.valor !== undefined) row.valor = deal.valor;
  if (deal.stage !== undefined) row.stage = deal.stage;
  if (deal.parceiro !== undefined) row.parceiro = deal.parceiro;
  if (deal.motivoPerda !== undefined) row.motivo_perda = deal.motivoPerda || null;
  return row;
}

export function CRMProvider({ children }: { children: React.ReactNode }) {
  const { session, profile } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const refresh = useCallback(async () => {
    if (!session) {
      setDeals([]);
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [dealsRes, profilesRes] = await Promise.all([
        supabase.from('deals').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*'),
      ]);
      if (dealsRes.error) throw dealsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const profs = (profilesRes.data || []) as Profile[];
      const pMap = new Map<string, Profile>();
      for (const p of profs) pMap.set(p.id, p);

      setProfiles(profs);
      setDeals((dealsRes.data || []).map(r => rowToDeal(r as DealRow, pMap)));
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao carregar dados: ' + (err.message || 'desconhecido'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addDeal = useCallback(
    async (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => {
      if (!session || !profile) return;
      const row = { ...dealToRow(deal), seller_id: session.user.id };
      const { data, error } = await supabase.from('deals').insert(row).select().single();
      if (error) {
        toast.error('Erro ao criar deal: ' + error.message);
        return;
      }
      setDeals(prev => [rowToDeal(data as DealRow, profileMap), ...prev]);
      toast.success('Deal criado');
    },
    [session, profile, profileMap]
  );

  const updateDeal = useCallback(
    async (id: string, updates: Partial<Deal>) => {
      const row = dealToRow(updates);
      const { data, error } = await supabase.from('deals').update(row).eq('id', id).select().single();
      if (error) {
        toast.error('Erro ao atualizar: ' + error.message);
        return;
      }
      setDeals(prev => prev.map(d => (d.id === id ? rowToDeal(data as DealRow, profileMap) : d)));
    },
    [profileMap]
  );

  const deleteDeal = useCallback(async (id: string) => {
    const { error } = await supabase.from('deals').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir: ' + error.message);
      return;
    }
    setDeals(prev => prev.filter(d => d.id !== id));
    toast.success('Deal excluído');
  }, []);

  const moveDeal = useCallback(
    async (id: string, newStage: Stage) => {
      // Optimistic update
      setDeals(prev => prev.map(d => (d.id === id ? { ...d, stage: newStage } : d)));
      const { error } = await supabase.from('deals').update({ stage: newStage }).eq('id', id);
      if (error) {
        toast.error('Erro ao mover: ' + error.message);
        await refresh();
      }
    },
    [refresh]
  );

  const importDeals = useCallback(
    async (newDeals: Omit<Deal, 'id' | 'sellerId' | 'sellerName' | 'updatedAt'>[]) => {
      if (!session) return;
      const rows = newDeals.map(d => ({
        ...dealToRow(d),
        seller_id: session.user.id,
        created_at: d.createdAt,
      }));
      const { data, error } = await supabase.from('deals').insert(rows).select();
      if (error) {
        toast.error('Erro ao importar: ' + error.message);
        return;
      }
      const inserted = (data || []).map(r => rowToDeal(r as DealRow, profileMap));
      setDeals(prev => [...inserted, ...prev]);
      toast.success(`${inserted.length} leads importados`);
    },
    [session, profileMap]
  );

  const filteredDeals = useMemo(() => {
    let result = [...deals];

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(d =>
        d.nome.toLowerCase().includes(s) ||
        d.origem.toLowerCase().includes(s) ||
        d.destino.toLowerCase().includes(s)
      );
    }
    if (filters.stage) result = result.filter(d => d.stage === filters.stage);
    if (filters.dateFrom) result = result.filter(d => d.createdAt >= filters.dateFrom!);
    if (filters.dateTo) result = result.filter(d => d.createdAt <= filters.dateTo!);
    if (filters.valueMin !== undefined) result = result.filter(d => d.valor >= filters.valueMin!);
    if (filters.valueMax !== undefined) result = result.filter(d => d.valor <= filters.valueMax!);
    if (filters.sellerId) result = result.filter(d => d.sellerId === filters.sellerId);

    result.sort((a, b) => {
      const aVal = sortField === 'valor' ? a.valor : new Date(a[sortField]).getTime();
      const bVal = sortField === 'valor' ? b.valor : new Date(b[sortField]).getTime();
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [deals, filters, sortField, sortDirection]);

  const getDealsByStage = useCallback(
    (stage: Stage) => filteredDeals.filter(d => d.stage === stage),
    [filteredDeals]
  );

  return (
    <CRMContext.Provider
      value={{
        deals,
        profiles,
        loading,
        filters,
        sortField,
        sortDirection,
        setFilters,
        setSortField,
        setSortDirection,
        addDeal,
        updateDeal,
        deleteDeal,
        moveDeal,
        importDeals,
        filteredDeals,
        getDealsByStage,
        refresh,
      }}
    >
      {children}
    </CRMContext.Provider>
  );
}

export function useCRM() {
  const ctx = useContext(CRMContext);
  if (!ctx) throw new Error('useCRM must be used within CRMProvider');
  return ctx;
}
