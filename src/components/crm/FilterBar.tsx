import { useCRM } from '@/contexts/CRMContext';
import { STAGES, Stage } from '@/types/crm';
import { Search, SlidersHorizontal, ArrowUpDown } from 'lucide-react';

const FilterBar = () => {
  const { filters, setFilters, sortField, setSortField, sortDirection, setSortDirection } = useCRM();

  return (
    <div className="filter-bar">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          placeholder="Buscar por nome, origem ou destino..."
          value={filters.search || ''}
          onChange={e => setFilters({ ...filters, search: e.target.value })}
          className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
        <select
          value={filters.stage || ''}
          onChange={e => setFilters({ ...filters, stage: (e.target.value || '') as Stage | '' })}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">Todas etapas</option>
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <input
        type="number"
        placeholder="Valor mín"
        value={filters.valueMin ?? ''}
        onChange={e => setFilters({ ...filters, valueMin: e.target.value ? Number(e.target.value) : undefined })}
        className="w-24 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
      />
      <input
        type="number"
        placeholder="Valor máx"
        value={filters.valueMax ?? ''}
        onChange={e => setFilters({ ...filters, valueMax: e.target.value ? Number(e.target.value) : undefined })}
        className="w-24 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
      />

      <div className="flex items-center gap-1.5">
        <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
        <select
          value={sortField}
          onChange={e => setSortField(e.target.value as typeof sortField)}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="createdAt">Data criação</option>
          <option value="valor">Valor</option>
          <option value="dataMudanca">Data mudança</option>
        </select>
        <button
          onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
          className="px-2 py-2 text-xs bg-muted border border-border rounded-lg text-muted-foreground hover:text-card-foreground transition-colors"
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
