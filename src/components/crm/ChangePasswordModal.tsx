import { useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { friendlyAuthError, validateNewPassword } from '@/lib/password';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass =
  'w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

const ChangePasswordModal = ({ isOpen, onClose }: ChangePasswordModalProps) => {
  const { changePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isOpen) return null;

  const close = () => {
    setPassword('');
    setConfirm('');
    setError(null);
    setDone(false);
    onClose();
  };

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
    else setDone(true);
  };

  // Vai para o <body> pelo mesmo motivo da Lixeira: o cabeçalho tem "backdrop-blur" e prenderia a janela no topo.
  return createPortal(
    <div className="modal-overlay" onClick={close}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-bold text-card-foreground">Alterar minha senha</h2>
          </div>
          <button onClick={close} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-5 space-y-4">
            <p className="text-sm text-card-foreground">Senha alterada. Use a senha nova no próximo login.</p>
            <button onClick={close} className="w-full px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90">
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Senha nova</label>
              <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Repita a senha nova</label>
              <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mínimo de 8 caracteres. Essa é a mesma senha usada nos outros sistemas da Maxtran.
            </p>
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar senha nova
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
};

export const ChangePasswordButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
        title="Alterar minha senha"
      >
        <KeyRound className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Senha</span>
      </button>
      <ChangePasswordModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default ChangePasswordModal;
