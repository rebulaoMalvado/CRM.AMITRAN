import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, createAdminSignupClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Profile } from '@/types/crm';
import { formatCurrency } from '@/lib/crm-utils';
import { ArrowLeft, UserPlus, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SellerStats {
  profile: Profile;
  total: number;
  fechados: number;
  perdidos: number;
  receita: number;
  pipeline: number;
}

const Admin = () => {
  const { profile, signOut } = useAuth();
  const [stats, setStats] = useState<SellerStats[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [profilesRes, dealsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('deals').select('seller_id, stage, valor'),
    ]);

    if (profilesRes.error || dealsRes.error) {
      toast.error('Erro ao carregar dados');
      setLoading(false);
      return;
    }

    const byUser = new Map<string, { total: number; fechados: number; perdidos: number; receita: number; pipeline: number }>();
    for (const d of dealsRes.data || []) {
      const entry = byUser.get(d.seller_id) || { total: 0, fechados: 0, perdidos: 0, receita: 0, pipeline: 0 };
      entry.total++;
      const v = Number(d.valor) || 0;
      if (d.stage === 'fechado') {
        entry.fechados++;
        entry.receita += v;
      } else if (d.stage === 'perdido') {
        entry.perdidos++;
      } else {
        entry.pipeline += v;
      }
      byUser.set(d.seller_id, entry);
    }

    const rows: SellerStats[] = (profilesRes.data as Profile[]).map(p => ({
      profile: p,
      ...(byUser.get(p.id) || { total: 0, fechados: 0, perdidos: 0, receita: 0, pipeline: 0 }),
    }));
    setStats(rows);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);

    const adminClient = createAdminSignupClient();
    const { error } = await adminClient.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), role: 'vendedor' } },
    });
    await adminClient.auth.signOut();
    setCreating(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    toast.success(`Vendedor ${name} criado`);
    setName('');
    setEmail('');
    setPassword('');
    await load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Vendedores</h1>
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

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Create form */}
        <section className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Criar novo vendedor
          </h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              required
              placeholder="Nome"
              value={name}
              onChange={e => setName(e.target.value)}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            />
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            />
            <input
              required
              type="text"
              minLength={6}
              placeholder="Senha (mín. 6)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            />
            <button
              type="submit"
              disabled={creating}
              className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Criar
            </button>
          </form>
          {formError && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-3">
              {formError}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            A senha pode ser trocada pelo próprio vendedor depois, via "Esqueci minha senha" (se o email estiver ativo no Supabase) ou por você direto no painel do Supabase.
          </p>
        </section>

        {/* Sellers list */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-card-foreground">
              Equipe ({stats.length})
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
                    <th className="text-left px-4 py-2.5 font-medium">Nome</th>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Tipo</th>
                    <th className="text-right px-4 py-2.5 font-medium">Leads</th>
                    <th className="text-right px-4 py-2.5 font-medium">Fechados</th>
                    <th className="text-right px-4 py-2.5 font-medium">Perdidos</th>
                    <th className="text-right px-4 py-2.5 font-medium">Pipeline</th>
                    <th className="text-right px-4 py-2.5 font-medium">Receita</th>
                    <th className="text-left px-4 py-2.5 font-medium">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(s => (
                    <tr key={s.profile.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium text-card-foreground">{s.profile.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.profile.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${s.profile.role === 'head' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {s.profile.role === 'head' ? 'HEAD' : 'VENDEDOR'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-card-foreground">{s.total}</td>
                      <td className="px-4 py-2.5 text-right text-success">{s.fechados}</td>
                      <td className="px-4 py-2.5 text-right text-destructive">{s.perdidos}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(s.pipeline)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-card-foreground">{formatCurrency(s.receita)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {format(new Date(s.profile.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                  {stats.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-sm">
                        Nenhum vendedor cadastrado ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Admin;
