import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { LogIn, Loader2, Mail } from 'lucide-react';
import { friendlyAuthError } from '@/lib/password';

const Login = () => {
  const { session, signIn, requestPasswordReset, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    if (resetMode) {
      const { error } = await requestPasswordReset(email.trim());
      setSubmitting(false);
      if (error) setError(friendlyAuthError(error));
      else setResetSent(true);
      return;
    }
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) setError(error === 'Invalid login credentials' ? 'Email ou senha incorretos' : error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center mb-6 gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-primary-foreground font-bold">A</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-card-foreground tracking-tight">Amitran CRM</h1>
            <p className="text-xs text-muted-foreground">Gestão de Pipeline</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-lg"
        >
          <h2 className="text-base font-semibold text-card-foreground">{resetMode ? 'Esqueci minha senha' : 'Entrar'}</h2>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {!resetMode && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Senha</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {resetMode && resetSent && (
            <div className="text-xs text-card-foreground bg-muted border border-border rounded-lg px-3 py-2">
              Se esse e-mail estiver cadastrado, enviamos um link para criar a senha nova. Olhe também o spam. O link funciona uma vez só: abra-o
              direto, no mesmo aparelho.
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || (resetMode && resetSent)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : resetMode ? <Mail className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
            {resetMode ? 'Enviar link por e-mail' : 'Entrar'}
          </button>

          <button
            type="button"
            onClick={() => {
              setResetMode(m => !m);
              setResetSent(false);
              setError(null);
            }}
            className="w-full text-center text-xs text-muted-foreground hover:text-card-foreground transition-colors"
          >
            {resetMode ? 'Voltar para o login' : 'Esqueci minha senha'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
