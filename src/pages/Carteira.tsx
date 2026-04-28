import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ProspectsProvider, useProspects } from '@/contexts/ProspectsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Prospect, ProspectStatus, PROSPECT_STATUS_LABEL } from '@/types/crm';
import ProspectModal from '@/components/prospects/ProspectModal';
import { ArrowLeft, LogOut, Search, Plus, Loader2, CheckCircle2, AlertCircle, User, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const statusStyles: Record<ProspectStatus, string> = {
  frio: 'bg-info/10 text-info',
  morno: 'bg-warning/10 text-warning',
  quente: 'bg-destructive/10 text-destructive',
};

const formatDate = (s?: string) => {
  if (!s) return '—';
  try {
    return format(parseISO(s), 'dd MMM yyyy', { locale: ptBR });
  } catch {
    return s;
  }
};

const isOverdue = (s?: string) => {
  if (!s) return false;
  const today = new Date().toISOString().split('T')[0];
  return s < today;
};

const CarteiraInner = () => {
  const { profile, isHead, signOut } = useAuth();
  const {
    filteredProspects,
    profiles,
    loading,
    filters,
    setFilters,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    addProspect,
    updateProspect,
    deleteProspect,
    markContactToday,
  } = useProspects();

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Prospect | null>(null);

  const sellers = profiles.filter(p => p.role === 'vendedor');

  const openNew = () => {
    setSelected(null);
    setModalOpen(true);
  };

  const openEdit = (p: Prospect) => {
    setSelected(p);
    setModalOpen(true);
  };

  const toggleSort = (f: typeof sortField) => {
    if (sortField === f) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(f);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (f: typeof sortField) => sortField === f ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Carteira de Prospects</h1>
              <p className="text-[11px] text-muted-foreground">{profile?.name} · {isHead ? 'Head de Vendas' : 'Vendedor'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo Prospect</span>
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Filtros */}
        <div className="filter-bar">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              placeholder="Buscar empresa, contato, email ou telefone..."
              value={filters.search || ''}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            />
          </div>

          <select
            value={filters.status || ''}
            onChange={e => setFilters({ ...filters, status: (e.target.value || '') as ProspectStatus | '' })}
            className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Todos status</option>
            {(Object.entries(PROSPECT_STATUS_LABEL) as [ProspectStatus, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <select
            value={filters.proximoContato || 'todos'}
            onChange={e => setFilters({ ...filters, proximoContato: e.target.value as any })}
            className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="todos">Próximo contato: todos</option>
            <option value="vencidos">Vencidos</option>
            <option value="esta_semana">Próximos 7 dias</option>
            <option value="sem_proximo">Sem próximo contato</option>
          </select>

          {isHead && sellers.length > 0 && (
            <select
              value={filters.sellerId || ''}
              onChange={e => setFilters({ ...filters, sellerId: e.target.value || undefined })}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Todos vendedores</option>
              {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>

        {/* Tabela */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-card-foreground">
              {filteredProspects.length} prospect{filteredProspects.length !== 1 ? 's' : ''}
            </h2>
          </div>

          {loading ? (
            <div className="p-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-card-foreground" onClick={() => toggleSort('empresa')}>
                      Empresa{sortIndicator('empresa')}
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium">Contato</th>
                    <th className="text-left px-4 py-2.5 font-medium">Telefone</th>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-card-foreground" onClick={() => toggleSort('status')}>
                      Status{sortIndicator('status')}
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-card-foreground" onClick={() => toggleSort('ultimoContato')}>
                      Último{sortIndicator('ultimoContato')}
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-card-foreground" onClick={() => toggleSort('proximoContato')}>
                      Próximo{sortIndicator('proximoContato')}
                    </th>
                    {isHead && <th className="text-left px-4 py-2.5 font-medium">Vendedor</th>}
                    <th className="text-right px-4 py-2.5 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProspects.map(p => (
                    <tr
                      key={p.id}
                      className="border-t border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => openEdit(p)}
                    >
                      <td className="px-4 py-2.5 font-medium text-card-foreground">{p.empresa}</td>
                      <td className="px-4 py-2.5 text-card-foreground">{p.contatoNome || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.telefone || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.email || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${statusStyles[p.status]}`}>
                          {PROSPECT_STATUS_LABEL[p.status].toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(p.ultimoContato)}</td>
                      <td className={`px-4 py-2.5 text-xs ${isOverdue(p.proximoContato) ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                        {p.proximoContato && isOverdue(p.proximoContato) && (
                          <AlertCircle className="inline w-3 h-3 mr-1" />
                        )}
                        {formatDate(p.proximoContato)}
                      </td>
                      {isHead && (
                        <td className="px-4 py-2.5 text-xs">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                            <User className="w-2.5 h-2.5" />
                            {p.sellerName || '—'}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => markContactToday(p.id)}
                          title="Marcar contato hoje"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-success/10 text-success hover:bg-success/20 transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Contato hoje
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredProspects.length === 0 && (
                    <tr>
                      <td colSpan={isHead ? 9 : 8} className="px-4 py-10 text-center text-muted-foreground text-sm">
                        Nenhum prospect ainda. Clica em <strong>Novo Prospect</strong> pra começar a montar a carteira.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          Próximo contato em vermelho = vencido. "Contato hoje" atualiza a data do último contato pra hoje rapidamente.
        </p>
      </main>

      <ProspectModal
        prospect={selected}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={addProspect}
        onUpdate={updateProspect}
        onDelete={deleteProspect}
      />
    </div>
  );
};

const Carteira = () => (
  <ProspectsProvider>
    <CarteiraInner />
  </ProspectsProvider>
);

export default Carteira;
