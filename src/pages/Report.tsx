import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Profile, Deal, LOSS_REASONS } from '@/types/crm';
import { formatCurrency } from '@/lib/crm-utils';
import { ArrowLeft, Loader2, LogOut, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

interface MonthlyRow {
  profile: Profile;
  novos: number;
  fechados: number;
  perdidos: number;
  emAbertoDoMes: number;
  receita: number;
  ticketMedio: number;
  conversao: number;
  motivosPerda: Record<string, number>;
}

const monthLabels = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

type RawDeal = {
  seller_id: string;
  stage: Deal['stage'];
  valor: number | null;
  created_at: string;
  closed_at: string | null;
  motivo_perda: Deal['motivoPerda'] | null;
};

const Report = () => {
  const { profile, signOut } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deals, setDeals] = useState<RawDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [profilesRes, dealsRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('deals').select('seller_id, stage, valor, created_at, closed_at, motivo_perda'),
      ]);
      if (profilesRes.error || dealsRes.error) {
        toast.error('Erro ao carregar relatório');
        setLoading(false);
        return;
      }
      setProfiles((profilesRes.data || []) as Profile[]);
      setDeals((dealsRes.data || []) as RawDeal[]);
      setLoading(false);
    };
    load();
  }, []);

  const rows = useMemo<MonthlyRow[]>(() => {
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 1).toISOString();

    const inCreated = (d: RawDeal) => d.created_at >= start && d.created_at < end;
    const inClosed = (d: RawDeal) => !!d.closed_at && d.closed_at >= start && d.closed_at < end;

    return profiles
      .filter(p => p.role === 'vendedor')
      .map(p => {
        const mine = deals.filter(d => d.seller_id === p.id);

        const novosLista = mine.filter(inCreated);
        const fechadosLista = mine.filter(d => d.stage === 'fechado' && inClosed(d));
        const perdidosLista = mine.filter(d => d.stage === 'perdido' && inClosed(d));
        const emAbertoDoMes = novosLista.filter(d => d.stage !== 'fechado' && d.stage !== 'perdido').length;

        const receita = fechadosLista.reduce((s, d) => s + (Number(d.valor) || 0), 0);
        const motivosPerda = perdidosLista.reduce((acc, d) => {
          const k = d.motivo_perda || 'outro';
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const decisoes = fechadosLista.length + perdidosLista.length;

        return {
          profile: p,
          novos: novosLista.length,
          fechados: fechadosLista.length,
          perdidos: perdidosLista.length,
          emAbertoDoMes,
          receita,
          ticketMedio: fechadosLista.length > 0 ? receita / fechadosLista.length : 0,
          conversao: decisoes > 0 ? (fechadosLista.length / decisoes) * 100 : 0,
          motivosPerda,
        };
      });
  }, [profiles, deals, year, month]);

  const totals = useMemo(() => {
    const t = { novos: 0, fechados: 0, perdidos: 0, emAbertoDoMes: 0, receita: 0 };
    for (const r of rows) {
      t.novos += r.novos;
      t.fechados += r.fechados;
      t.perdidos += r.perdidos;
      t.emAbertoDoMes += r.emAbertoDoMes;
      t.receita += r.receita;
    }
    return t;
  }, [rows]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Relatório Mensal</h1>
              <p className="text-[11px] text-muted-foreground">{profile?.name} · Head de Vendas</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 flex-wrap">
          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Período:</span>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {monthLabels.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="Novos leads" value={totals.novos.toString()} hint="criados no mês" />
              <StatCard label="Fechados" value={totals.fechados.toString()} accent="text-success" hint="fechados no mês" />
              <StatCard label="Perdidos" value={totals.perdidos.toString()} accent="text-destructive" hint="perdidos no mês" />
              <StatCard label="Em aberto" value={totals.emAbertoDoMes.toString()} hint="do mês, ainda ativos" />
              <StatCard label="Receita" value={formatCurrency(totals.receita)} accent="text-success" hint="fechados no mês" />
            </div>

            <section className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-card-foreground">
                  Por vendedor · {monthLabels[month]} {year}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1">
                  "Fechados"/"Perdidos" contam pela data de fechamento · "Novos" e "Em aberto" pela data de criação
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Vendedor</th>
                      <th className="text-right px-4 py-2.5 font-medium">Novos</th>
                      <th className="text-right px-4 py-2.5 font-medium">Fechados</th>
                      <th className="text-right px-4 py-2.5 font-medium">Perdidos</th>
                      <th className="text-right px-4 py-2.5 font-medium">Em aberto</th>
                      <th className="text-right px-4 py-2.5 font-medium">Conv.</th>
                      <th className="text-right px-4 py-2.5 font-medium">Ticket médio</th>
                      <th className="text-right px-4 py-2.5 font-medium">Receita</th>
                      <th className="text-left px-4 py-2.5 font-medium">Motivos de perda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.profile.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium text-card-foreground">{r.profile.name}</td>
                        <td className="px-4 py-2.5 text-right text-card-foreground">{r.novos}</td>
                        <td className="px-4 py-2.5 text-right text-success">{r.fechados}</td>
                        <td className="px-4 py-2.5 text-right text-destructive">{r.perdidos}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{r.emAbertoDoMes}</td>
                        <td className="px-4 py-2.5 text-right text-card-foreground">{r.conversao.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(r.ticketMedio)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-card-foreground">{formatCurrency(r.receita)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {Object.entries(r.motivosPerda).length === 0 ? '—' :
                            Object.entries(r.motivosPerda)
                              .map(([k, v]) => `${LOSS_REASONS[k as keyof typeof LOSS_REASONS] || k}: ${v}`)
                              .join(' · ')
                          }
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-sm">
                          Nenhum vendedor cadastrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

const StatCard = ({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
    <div className={`text-xl font-bold ${accent || 'text-card-foreground'}`}>{value}</div>
    {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
  </div>
);

export default Report;
