import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CRMProvider } from '@/contexts/CRMContext';
import { useAuth } from '@/contexts/AuthContext';
import KPICards from '@/components/crm/KPICards';
import Charts from '@/components/crm/Charts';
import Pipeline from '@/components/crm/Pipeline';
import FilterBar from '@/components/crm/FilterBar';
import CSVActions from '@/components/crm/CSVActions';
import { BarChart3, ChevronDown, ChevronUp, LogOut, Users, FileBarChart, Briefcase, Wallet } from 'lucide-react';

const CRMDashboard = () => {
  const [showCharts, setShowCharts] = useState(false);
  const { profile, isHead, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">N</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">NOG CRM</h1>
              <p className="text-[11px] text-muted-foreground">
                {profile?.name} · {isHead ? 'Head de Vendas' : 'Vendedor'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/carteira"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
              title="Carteira de prospects"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Carteira</span>
            </Link>
            {isHead && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
                title="Gerenciar vendedores"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vendedores</span>
              </Link>
            )}
            <Link
              to="/parcelas"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
              title="Parcelas de pagamento"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Parcelas</span>
            </Link>
            {isHead && (
              <Link
                to="/relatorio"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
                title="Relatório mensal"
              >
                <FileBarChart className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Relatório</span>
              </Link>
            )}
            <CSVActions />
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
              title="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <section className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-4 pb-2">
        <KPICards />
      </section>

      {/* Filter Bar */}
      <section className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pb-2">
        <FilterBar />
      </section>

      {/* Pipeline */}
      <section className="flex-1 bg-muted/30 border-y border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">
          <Pipeline />
        </div>
      </section>

      {/* Analytics - collapsible */}
      <section className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-4">
        <button
          onClick={() => setShowCharts(!showCharts)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-card-foreground transition-colors mb-4"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {showCharts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showCharts ? 'Ocultar Analytics' : 'Mostrar Analytics'}
        </button>
        {showCharts && <Charts />}
      </section>
    </div>
  );
};

const Index = () => (
  <CRMProvider>
    <CRMDashboard />
  </CRMProvider>
);

export default Index;
