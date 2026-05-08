import { useEffect, useMemo, useRef, useState } from 'react';
import { Deal, Profile } from '@/types/crm';
import { useCRM } from '@/contexts/CRMContext';
import { buildPropostaHtml, formatDateBR, imprimirProposta, type PropostaForm } from '@/lib/proposta';
import { formatCurrency } from '@/lib/crm-utils';
import { toast } from 'sonner';
import { X, Printer, Loader2 } from 'lucide-react';

interface PropostaModalProps {
  deal: Deal;
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULTS = {
  tipo: 'Residencial',
  valorSeguro: 'A DECLARAR',
};

const buildInitialForm = (deal: Deal, vendedor?: Profile): PropostaForm => ({
  nomeCliente: deal.nome || '',
  telefoneCliente: deal.telefone || '',
  volumeEstimado: '',
  dataMudanca: deal.dataMudanca || '',
  tipo: DEFAULTS.tipo,
  origem: deal.origem || '',
  destino: deal.destino || '',
  valorMudanca: Number(deal.valor) || 0,
  valorSeguro: DEFAULTS.valorSeguro,
  nomeVendedor: vendedor?.name || deal.sellerName || '',
  emailVendedor: vendedor?.email || '',
});

const sanitizeFileName = (s: string): string =>
  s.replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().replace(/\s+/g, '_') || 'cliente';

const PropostaModal = ({ deal, isOpen, onClose }: PropostaModalProps) => {
  const { profiles, updateDeal } = useCRM();
  const vendedor = useMemo(() => profiles.find(p => p.id === deal.sellerId), [profiles, deal.sellerId]);

  const [form, setForm] = useState<PropostaForm>(() => buildInitialForm(deal, vendedor));
  const [baseTemplate, setBaseTemplate] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Reseta form quando o deal muda
  useEffect(() => {
    setForm(buildInitialForm(deal, vendedor));
  }, [deal, vendedor]);

  // Carrega template uma vez
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingTemplate(true);
    buildPropostaHtml(buildInitialForm(deal, vendedor))
      .then(html => {
        if (cancelled) return;
        setPreviewHtml(html);
        // Cache a versão "achatada" sem form aplicado pra atualizações rápidas
        // posteriores. Reaplicamos a partir desta string.
        setBaseTemplate(html);
        setLoadingTemplate(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'desconhecido';
        toast.error('Erro ao carregar proposta: ' + message);
        setLoadingTemplate(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal.id]);

  // Atualiza preview com debounce ao mudar form
  useEffect(() => {
    if (!isOpen || !baseTemplate) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      // baseTemplate já foi construído com o form inicial — refazemos a partir
      // do template "limpo" recarregando do cache de buildPropostaHtml.
      buildPropostaHtml(form)
        .then(html => setPreviewHtml(html))
        .catch(() => { /* erros já reportados na carga inicial */ });
    }, 250);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [form, isOpen, baseTemplate]);

  const changedFields = useMemo(() => {
    const diffs: { label: string; from: string; to: string }[] = [];
    if (form.nomeCliente !== (deal.nome || '')) {
      diffs.push({ label: 'Nome', from: deal.nome || '—', to: form.nomeCliente || '—' });
    }
    if (form.telefoneCliente !== (deal.telefone || '')) {
      diffs.push({ label: 'Telefone', from: deal.telefone || '—', to: form.telefoneCliente || '—' });
    }
    if (form.dataMudanca !== (deal.dataMudanca || '')) {
      diffs.push({
        label: 'Data da mudança',
        from: deal.dataMudanca ? formatDateBR(deal.dataMudanca) : '—',
        to: form.dataMudanca ? formatDateBR(form.dataMudanca) : '—',
      });
    }
    if (form.origem !== (deal.origem || '')) {
      diffs.push({ label: 'Origem', from: deal.origem || '—', to: form.origem || '—' });
    }
    if (form.destino !== (deal.destino || '')) {
      diffs.push({ label: 'Destino', from: deal.destino || '—', to: form.destino || '—' });
    }
    if (Number(form.valorMudanca) !== Number(deal.valor || 0)) {
      diffs.push({
        label: 'Valor',
        from: formatCurrency(Number(deal.valor) || 0),
        to: formatCurrency(Number(form.valorMudanca) || 0),
      });
    }
    return diffs;
  }, [form, deal]);

  if (!isOpen) return null;

  const totalText = `R$ ${formatCurrencyPlain(form.valorMudanca)} + 2% do valor do seguro`;

  const handleGerarClick = () => {
    if (changedFields.length > 0) {
      setShowConfirm(true);
    } else {
      void doGerarPdf(false);
    }
  };

  const doGerarPdf = async (alsoUpdateDeal: boolean) => {
    setShowConfirm(false);
    setGenerating(true);
    try {
      if (alsoUpdateDeal) {
        await updateDeal(deal.id, {
          nome: form.nomeCliente,
          telefone: form.telefoneCliente,
          dataMudanca: form.dataMudanca,
          origem: form.origem,
          destino: form.destino,
          valor: Number(form.valorMudanca) || 0,
        });
        toast.success('Deal atualizado');
      }
      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const docTitle = `Proposta_Amitran_${sanitizeFileName(form.nomeCliente)}_${stamp}`;
      await imprimirProposta(form, docTitle);
      toast.success('Diálogo de impressão aberto. Escolha "Salvar como PDF".');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'desconhecido';
      toast.error('Erro ao abrir impressão: ' + message);
    } finally {
      setGenerating(false);
    }
  };

  const setField = <K extends keyof PropostaForm>(key: K, value: PropostaForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold text-card-foreground">Gerar Proposta Comercial</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Edite os campos à esquerda — o preview à direita atualiza em tempo real.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] min-h-0">
          {/* Coluna form */}
          <div className="border-r border-border overflow-y-auto p-5 space-y-3">
            <Field label="Nome cliente">
              <input
                value={form.nomeCliente}
                onChange={e => setField('nomeCliente', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Telefone cliente">
              <input
                value={form.telefoneCliente}
                onChange={e => setField('telefoneCliente', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Volume estimado">
              <div className="relative">
                <input
                  value={form.volumeEstimado}
                  onChange={e => setField('volumeEstimado', e.target.value)}
                  placeholder="ex: 22"
                  className={inputCls + ' pr-10'}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">m³</span>
              </div>
            </Field>
            <Field label="Data da mudança">
              <input
                type="date"
                value={form.dataMudanca}
                onChange={e => setField('dataMudanca', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Tipo">
              <input
                value={form.tipo}
                onChange={e => setField('tipo', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Origem">
              <input
                value={form.origem}
                onChange={e => setField('origem', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Destino">
              <input
                value={form.destino}
                onChange={e => setField('destino', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Valor da mudança (R$)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.valorMudanca}
                onChange={e => setField('valorMudanca', Number(e.target.value))}
                className={inputCls}
              />
              <span className="text-[11px] text-muted-foreground mt-1 block">{formatCurrency(Number(form.valorMudanca) || 0)}</span>
            </Field>
            <Field label="Valor do seguro">
              <input
                value={form.valorSeguro}
                onChange={e => setField('valorSeguro', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Total">
              <input value={totalText} readOnly className={inputCls + ' bg-muted/40 cursor-not-allowed'} />
            </Field>
          </div>

          {/* Coluna preview */}
          <div className="bg-muted/30 overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 overflow-auto p-4 flex justify-center">
              {loadingTemplate || !previewHtml ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm self-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando proposta...
                </div>
              ) : (
                <iframe
                  title="Preview da Proposta"
                  srcDoc={previewHtml}
                  className="bg-white shadow-lg rounded"
                  style={{ width: '210mm', minHeight: '297mm', border: 0 }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleGerarClick}
            disabled={generating || loadingTemplate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
            {generating ? 'Abrindo...' : 'Gerar PDF'}
          </button>
        </div>
      </div>

      {showConfirm && (
        <ConfirmUpdateModal
          changes={changedFields}
          onCancel={() => setShowConfirm(false)}
          onJustPdf={() => void doGerarPdf(false)}
          onUpdateAndPdf={() => void doGerarPdf(true)}
        />
      )}
    </div>
  );
};

const inputCls =
  'w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
    {children}
  </div>
);

const formatCurrencyPlain = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ConfirmProps {
  changes: { label: string; from: string; to: string }[];
  onCancel: () => void;
  onJustPdf: () => void;
  onUpdateAndPdf: () => void;
}

const ConfirmUpdateModal = ({ changes, onCancel, onJustPdf, onUpdateAndPdf }: ConfirmProps) => (
  <div
    className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
    onClick={onCancel}
  >
    <div
      className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-5 space-y-4"
      onClick={e => e.stopPropagation()}
    >
      <div>
        <h3 className="text-base font-bold text-card-foreground">Atualizar deal?</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Você alterou os campos abaixo. Deseja salvar as alterações no deal também?
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 divide-y divide-border text-xs">
        {changes.map(c => (
          <div key={c.label} className="px-3 py-2 grid grid-cols-[110px_1fr] gap-2">
            <span className="font-semibold text-card-foreground">{c.label}</span>
            <span className="text-muted-foreground truncate">
              <span className="line-through">{c.from}</span>
              {' → '}
              <span className="text-card-foreground font-medium">{c.to}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={onUpdateAndPdf}
          className="w-full px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          Sim, atualizar deal e gerar PDF
        </button>
        <button
          onClick={onJustPdf}
          className="w-full px-4 py-2 text-sm text-card-foreground bg-muted hover:bg-accent rounded-lg transition-colors"
        >
          Não, só gerar PDF
        </button>
        <button
          onClick={onCancel}
          className="w-full px-4 py-2 text-xs text-muted-foreground hover:bg-muted rounded-lg transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
);

export default PropostaModal;
