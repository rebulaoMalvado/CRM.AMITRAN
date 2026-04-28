import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Prospect, ProspectFilters, ProspectSortField, SortDirection, Profile, ProspectStatus } from '@/types/crm';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

interface ProspectsContextType {
  prospects: Prospect[];
  profiles: Profile[];
  loading: boolean;
  filters: ProspectFilters;
  sortField: ProspectSortField;
  sortDirection: SortDirection;
  setFilters: (f: ProspectFilters) => void;
  setSortField: (f: ProspectSortField) => void;
  setSortDirection: (d: SortDirection) => void;
  addProspect: (p: Omit<Prospect, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => Promise<void>;
  updateProspect: (id: string, updates: Partial<Prospect>) => Promise<void>;
  deleteProspect: (id: string) => Promise<void>;
  markContactToday: (id: string) => Promise<void>;
  filteredProspects: Prospect[];
  refresh: () => Promise<void>;
}

const ProspectsContext = createContext<ProspectsContextType | null>(null);

type ProspectRow = {
  id: string;
  seller_id: string;
  empresa: string;
  contato_nome: string | null;
  telefone: string | null;
  email: string | null;
  status: ProspectStatus;
  ultimo_contato: string | null;
  proximo_contato: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProspect(row: ProspectRow, profileMap: Map<string, Profile>): Prospect {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: profileMap.get(row.seller_id)?.name,
    empresa: row.empresa,
    contatoNome: row.contato_nome || '',
    telefone: row.telefone || '',
    email: row.email || '',
    status: row.status,
    ultimoContato: row.ultimo_contato || undefined,
    proximoContato: row.proximo_contato || undefined,
    observacoes: row.observacoes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function prospectToRow(p: Partial<Prospect>): Partial<ProspectRow> {
  const r: Partial<ProspectRow> = {};
  if (p.sellerId !== undefined) r.seller_id = p.sellerId;
  if (p.empresa !== undefined) r.empresa = p.empresa;
  if (p.contatoNome !== undefined) r.contato_nome = p.contatoNome;
  if (p.telefone !== undefined) r.telefone = p.telefone;
  if (p.email !== undefined) r.email = p.email;
  if (p.status !== undefined) r.status = p.status;
  if (p.ultimoContato !== undefined) r.ultimo_contato = p.ultimoContato || null;
  if (p.proximoContato !== undefined) r.proximo_contato = p.proximoContato || null;
  if (p.observacoes !== undefined) r.observacoes = p.observacoes;
  return r;
}

export function ProspectsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ProspectFilters>({});
  const [sortField, setSortField] = useState<ProspectSortField>('proximoContato');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const refresh = useCallback(async () => {
    if (!session) {
      setProspects([]);
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [pRes, profRes] = await Promise.all([
        supabase.from('prospects').select('*').order('updated_at', { ascending: false }),
        supabase.from('profiles').select('*'),
      ]);
      if (pRes.error) throw pRes.error;
      if (profRes.error) throw profRes.error;

      const profs = (profRes.data || []) as Profile[];
      const map = new Map<string, Profile>();
      for (const p of profs) map.set(p.id, p);

      setProfiles(profs);
      setProspects((pRes.data || []).map(r => rowToProspect(r as ProspectRow, map)));
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao carregar carteira: ' + (err.message || 'desconhecido'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addProspect = useCallback(
    async (p: Omit<Prospect, 'id' | 'createdAt' | 'updatedAt' | 'sellerId' | 'sellerName'>) => {
      if (!session) return;
      const row = { ...prospectToRow(p), seller_id: session.user.id };
      const { data, error } = await supabase.from('prospects').insert(row).select().single();
      if (error) {
        toast.error('Erro ao criar prospect: ' + error.message);
        return;
      }
      setProspects(prev => [rowToProspect(data as ProspectRow, profileMap), ...prev]);
      toast.success('Prospect adicionado');
    },
    [session, profileMap]
  );

  const updateProspect = useCallback(
    async (id: string, updates: Partial<Prospect>) => {
      const { data, error } = await supabase.from('prospects').update(prospectToRow(updates)).eq('id', id).select().single();
      if (error) {
        toast.error('Erro ao atualizar: ' + error.message);
        return;
      }
      setProspects(prev => prev.map(p => (p.id === id ? rowToProspect(data as ProspectRow, profileMap) : p)));
    },
    [profileMap]
  );

  const deleteProspect = useCallback(async (id: string) => {
    const { error } = await supabase.from('prospects').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir: ' + error.message);
      return;
    }
    setProspects(prev => prev.filter(p => p.id !== id));
    toast.success('Prospect excluído');
  }, []);

  const markContactToday = useCallback(
    async (id: string) => {
      const today = new Date().toISOString().split('T')[0];
      await updateProspect(id, { ultimoContato: today });
      toast.success('Contato registrado hoje');
    },
    [updateProspect]
  );

  const filteredProspects = useMemo(() => {
    let result = [...prospects];

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(
        p =>
          p.empresa.toLowerCase().includes(s) ||
          p.contatoNome.toLowerCase().includes(s) ||
          p.email.toLowerCase().includes(s) ||
          p.telefone.toLowerCase().includes(s)
      );
    }
    if (filters.status) result = result.filter(p => p.status === filters.status);
    if (filters.sellerId) result = result.filter(p => p.sellerId === filters.sellerId);

    if (filters.proximoContato && filters.proximoContato !== 'todos') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      result = result.filter(p => {
        if (filters.proximoContato === 'sem_proximo') return !p.proximoContato;
        if (!p.proximoContato) return false;
        if (filters.proximoContato === 'vencidos') return p.proximoContato < todayStr;
        if (filters.proximoContato === 'esta_semana') return p.proximoContato >= todayStr && p.proximoContato <= weekEndStr;
        return true;
      });
    }

    const statusOrder: Record<ProspectStatus, number> = { quente: 0, morno: 1, frio: 2 };
    result.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      if (sortField === 'status') {
        aVal = statusOrder[a.status];
        bVal = statusOrder[b.status];
      } else if (sortField === 'empresa') {
        aVal = a.empresa.toLowerCase();
        bVal = b.empresa.toLowerCase();
      } else {
        // ultimoContato | proximoContato — vazios no fim
        const av = a[sortField];
        const bv = b[sortField];
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        aVal = av;
        bVal = bv;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [prospects, filters, sortField, sortDirection]);

  return (
    <ProspectsContext.Provider
      value={{
        prospects,
        profiles,
        loading,
        filters,
        sortField,
        sortDirection,
        setFilters,
        setSortField,
        setSortDirection,
        addProspect,
        updateProspect,
        deleteProspect,
        markContactToday,
        filteredProspects,
        refresh,
      }}
    >
      {children}
    </ProspectsContext.Provider>
  );
}

export function useProspects() {
  const ctx = useContext(ProspectsContext);
  if (!ctx) throw new Error('useProspects must be used within ProspectsProvider');
  return ctx;
}
