import { useRef } from 'react';
import { useCRM } from '@/contexts/CRMContext';
import { useAuth } from '@/contexts/AuthContext';
import { Deal, Stage, ServiceType, LossReason } from '@/types/crm';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

const CSV_HEADERS = 'name,phone,origin,destination,date,serviceType,value,stage,partner,lossReason,createdAt,sellerName';

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
  const { filteredDeals, importDeals } = useCRM();
  const { profile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const rows = filteredDeals.map(d =>
      [
        d.nome, d.telefone, d.origem, d.destino, d.dataMudanca,
        d.tipoServico, String(d.valor), d.stage, d.parceiro,
        d.motivoPerda || '', d.createdAt, d.sellerName || '',
      ]
        .map(escapeCSV).join(',')
    );
    const csv = [CSV_HEADERS, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    const ownerTag = profile?.name ? `-${profile.name.replace(/\s+/g, '_').toLowerCase()}` : '';
    a.href = url;
    a.download = `crm-nog${ownerTag}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filteredDeals.length} leads exportados`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('Arquivo vazio');

      type ImportDeal = Omit<Deal, 'id' | 'sellerId' | 'sellerName' | 'updatedAt'>;
      const imported: ImportDeal[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 9) continue;
        const [nome, telefone, origem, destino, dataMudanca, tipoServico, valor, stage, parceiro, motivoPerda, createdAt] = cols;
        const validStage = VALID_STAGES.includes(stage as Stage) ? (stage as Stage) : 'lead_novo';
        const validService = VALID_SERVICES.includes(tipoServico as ServiceType) ? (tipoServico as ServiceType) : 'economico';
        const now = new Date().toISOString();
        imported.push({
          nome: nome || 'Sem nome',
          telefone: telefone || '',
          origem: origem || '',
          destino: destino || '',
          dataMudanca: dataMudanca || '',
          tipoServico: validService,
          valor: Number(valor) || 0,
          stage: validStage,
          parceiro: parceiro || '',
          motivoPerda: motivoPerda && VALID_LOSS.includes(motivoPerda as LossReason) ? (motivoPerda as LossReason) : undefined,
          createdAt: createdAt || now,
        });
      }
      if (imported.length === 0) throw new Error('Nenhum lead válido encontrado');
      await importDeals(imported);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar CSV');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleExport}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
        title="Exportar leads visíveis (filtrados)"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Export</span>
      </button>
      <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors cursor-pointer" title="Importar leads para sua conta">
        <Upload className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Import</span>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />
      </label>
    </div>
  );
};

export default CSVActions;
