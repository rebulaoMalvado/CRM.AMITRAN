import { useRef } from 'react';
import { useCRM } from '@/contexts/CRMContext';
import { Deal, Stage, ServiceType, LossReason } from '@/types/crm';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

const CSV_HEADERS = 'name,phone,origin,destination,date,serviceType,value,stage,partner,lossReason,createdAt';

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

const VALID_STAGES: Stage[] = ['lead_novo', 'qualificacao', 'orcamento_enviado', 'negociacao', 'fechado', 'perdido'];
const VALID_SERVICES: ServiceType[] = ['economico', 'completo'];
const VALID_LOSS: LossReason[] = ['preco', 'concorrencia', 'desistiu', 'sem_resposta', 'outro'];

const CSVActions = () => {
  const { deals, importDeals } = useCRM();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const rows = deals.map(d =>
      [d.nome, d.telefone, d.origem, d.destino, d.dataMudanca, d.tipoServico, String(d.valor), d.stage, d.parceiro, d.motivoPerda || '', d.createdAt]
        .map(escapeCSV).join(',')
    );
    const csv = [CSV_HEADERS, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'crm-nog.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${deals.length} leads exportados com sucesso`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('Arquivo vazio');

        const imported: Deal[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (cols.length < 9) continue;
          const [nome, telefone, origem, destino, dataMudanca, tipoServico, valor, stage, parceiro, motivoPerda, createdAt] = cols;
          const validStage = VALID_STAGES.includes(stage as Stage) ? (stage as Stage) : 'lead_novo';
          const validService = VALID_SERVICES.includes(tipoServico as ServiceType) ? (tipoServico as ServiceType) : 'economico';
          const now = new Date().toISOString();
          imported.push({
            id: crypto.randomUUID(),
            nome: nome || 'Sem nome',
            telefone: telefone || '',
            origem: origem || '',
            destino: destino || '',
            dataMudanca: dataMudanca || now,
            tipoServico: validService,
            valor: Number(valor) || 0,
            stage: validStage,
            parceiro: parceiro || '',
            motivoPerda: motivoPerda && VALID_LOSS.includes(motivoPerda as LossReason) ? (motivoPerda as LossReason) : undefined,
            createdAt: createdAt || now,
            updatedAt: now,
          });
        }
        if (imported.length === 0) throw new Error('Nenhum lead válido encontrado');
        importDeals(imported);
        toast.success(`${imported.length} leads importados com sucesso`);
      } catch (err: any) {
        toast.error(err.message || 'Erro ao importar CSV');
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleExport}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
      >
        <Download className="w-3.5 h-3.5" /> Export
      </button>
      <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors cursor-pointer">
        <Upload className="w-3.5 h-3.5" /> Import
        <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />
      </label>
    </div>
  );
};

export default CSVActions;
