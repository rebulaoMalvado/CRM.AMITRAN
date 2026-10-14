import { Bot, Loader2 } from 'lucide-react';
import { SdrConfig } from '@/types/whatsapp';

interface Props {
  config: SdrConfig | null;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onModeChange: (mode: 'shadow' | 'auto') => void;
}

/**
 * Painel do Head: interruptor GERAL da Carol e o modo.
 * - Sombra (padrão): só escreve rascunhos, nada é enviado ao cliente.
 * - Automático: responde sozinha (a lista de números liberados fica no servidor: SDR_AUTO_ALLOWLIST).
 */
const SdrPanel = ({ config, busy, onToggle, onModeChange }: Props) => {
  const enabled = config?.ai_enabled === true;
  const auto = config?.mode === 'auto';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border">
      <Bot className={`w-4 h-4 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
      <div className="leading-tight">
        <div className="text-xs font-semibold text-card-foreground">Carol: {enabled ? 'LIGADA' : 'desligada'}</div>
        <div className={`text-[10px] ${auto && enabled ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
          {auto ? 'Automático: responde sozinha aos clientes' : 'Sombra: só rascunhos, não envia'}
        </div>
      </div>

      <select
        aria-label="Modo da Carol"
        value={config?.mode ?? 'shadow'}
        disabled={busy || !config}
        onChange={e => {
          const mode = e.target.value as 'shadow' | 'auto';
          if (
            mode === 'auto' &&
            !window.confirm(
              'Ativar o ENVIO AUTOMÁTICO?\n\nA Carol vai responder sozinha aos clientes, sem ninguém aprovar.\n\nPara parar a qualquer momento: desligue a Carol aqui.',
            )
          )
            return;
          onModeChange(mode);
        }}
        className="text-[11px] px-1.5 py-1 rounded bg-background border border-border text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <option value="shadow">Sombra</option>
        <option value="auto">Automático</option>
      </select>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Ligar ou desligar a Carol"
        disabled={busy || !config}
        onClick={() => {
          if (!enabled && !window.confirm(auto ? 'Ligar a Carol em modo AUTOMÁTICO? Ela responderá sozinha aos clientes.' : 'Ligar a Carol? Ela vai escrever RASCUNHOS nas conversas novas (nada é enviado ao cliente).')) return;
          onToggle(!enabled);
        }}
        className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-primary' : 'bg-border'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-background transition-all ${enabled ? 'left-5' : 'left-0.5'}`} />
      </button>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
};

export default SdrPanel;
