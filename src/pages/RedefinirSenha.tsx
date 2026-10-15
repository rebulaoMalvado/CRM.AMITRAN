import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { friendlyAuthError, validateNewPassword } from '@/lib/password';

const inputClass =
  'w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

// Página aberta pelo link do e-mail "esqueci minha senha". O Supabase lê o link e abre uma sessão
// temporária sozinho; se existir sessão, mostramos o formulário da senha nova.
const RedefinirSenha = () => {
  const { session, loading, changePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: err } = await changePassword(password);
    setSubmitting(false);
    if (err) setError(friendlyAuthError(err));
    else {
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    }
  };

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex justify-center py-6">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (done) {
    body = <p className="text-sm text-card-foreground">Senha alterada! Entrando no CRM…</p>;
  } else if (!session) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-card-foreground">
          Este link é inválido ou já foi usado. Cada link só funciona uma vez e vence em pouco tempo.
        </p>
        <Link to="/login" className="block w-full text-center px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90">
          Pedir um link novo
        </Link>
      </div>
    );
  } else {
    body = (
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Senha nova</label>
          <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Repita a senha nova</label>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
        </div>
        <p className="text-[11px] text-muted-foreground">Mínimo de 8 caracteres.</p>
        {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Salvar senha nova
        </button>
      </form>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-lg">
          <h2 className="text-base font-semibold text-card-foreground">Criar senha nova</h2>
          {body}
        </div>
      </div>
    </div>
  );
};

export default RedefinirSenha;
