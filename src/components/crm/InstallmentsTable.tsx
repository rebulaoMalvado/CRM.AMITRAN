import { InstallmentWithDeal } from '@/types/crm';
import { formatCurrency } from '@/lib/crm-utils';
import { CheckCircle2, Clock, User, Loader2 } from 'lucide-react';

interface InstallmentsTableProps {
  installments: InstallmentWithDeal[];
  loading?: boolean;
  isHead?: boolean;
  onRowClick?: (installment: InstallmentWithDeal) => void;
  emptyMessage?: string;
}

const formatDateBR = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const InstallmentsTable = ({
  installments,
  loading,
  isHead,
  onRowClick,
  emptyMessage = 'Nenhuma parcela encontrada com os filtros atuais.',
}: InstallmentsTableProps) => {
  if (loading) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
            <th className="text-left px-4 py-2.5 font-medium">Parcela</th>
            <th className="text-left px-4 py-2.5 font-medium">Valor previsto</th>
            <th className="text-left px-4 py-2.5 font-medium">Vencimento</th>
            <th className="text-left px-4 py-2.5 font-medium">Status</th>
            <th className="text-left px-4 py-2.5 font-medium">Recebido</th>
            {isHead && <th className="text-left px-4 py-2.5 font-medium">Vendedor</th>}
          </tr>
        </thead>
        <tbody>
          {installments.map(i => (
            <tr
              key={i.id}
              className={`border-t border-border ${onRowClick ? 'hover:bg-muted/30 cursor-pointer' : ''}`}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
            >
              <td className="px-4 py-2.5 font-medium text-card-foreground">{i.dealNome}</td>
              <td className="px-4 py-2.5 text-muted-foreground">
                Parcela {i.installmentNumber}/{i.dealInstallmentsTotal}
              </td>
              <td className="px-4 py-2.5 text-card-foreground">{formatCurrency(i.amount)}</td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDateBR(i.dueDate)}</td>
              <td className="px-4 py-2.5">
                {i.isReceived ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-success/10 text-success">
                    <CheckCircle2 className="w-3 h-3" /> RECEBIDA
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-info/10 text-info">
                    <Clock className="w-3 h-3" /> PREVISTA
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {i.isReceived && i.receivedDate ? (
                  <span className="text-success font-medium">
                    {formatCurrency(Number(i.receivedAmount ?? i.amount))} · {formatDateBR(i.receivedDate)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              {isHead && (
                <td className="px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                    <User className="w-2.5 h-2.5" />
                    {i.dealSellerName || '—'}
                  </span>
                </td>
              )}
            </tr>
          ))}
          {installments.length === 0 && (
            <tr>
              <td colSpan={isHead ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground text-sm">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default InstallmentsTable;
