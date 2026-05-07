import { useMemo } from 'react';
import { InstallmentWithDeal } from '@/types/crm';
import { formatCurrency } from '@/lib/crm-utils';
import { CheckCircle2 } from 'lucide-react';

interface FinanceiroCalendarProps {
  /** Ano (4 dígitos) e mês (0-11) sendo visualizados. */
  year: number;
  month: number;
  /** Parcelas com due_date no mês visualizado. */
  installments: InstallmentWithDeal[];
  /** Data ISO (YYYY-MM-DD) selecionada — destaca a célula. */
  selectedDayISO: string | null;
  onDayClick: (iso: string) => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const localISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => localISO(new Date());

/** Constrói a grade do mês: começa no domingo anterior ao dia 1 e
 *  vai até o sábado seguinte ao último dia. Sempre múltiplo de 7. */
function buildGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = firstOfMonth.getDay();
  const endDow = lastOfMonth.getDay();
  const totalDays = startDow + lastOfMonth.getDate() + (6 - endDow);

  const start = new Date(year, month, 1 - startDow);
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

const FinanceiroCalendar = ({ year, month, installments, selectedDayISO, onDayClick }: FinanceiroCalendarProps) => {
  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const today = todayISO();

  const byDate = useMemo(() => {
    const map = new Map<string, InstallmentWithDeal[]>();
    for (const i of installments) {
      const list = map.get(i.dueDate) || [];
      list.push(i);
      map.set(i.dueDate, list);
    }
    return map;
  }, [installments]);

  if (installments.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
        Nenhum recebimento previsto neste mês.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/50 text-[11px] uppercase font-semibold text-muted-foreground">
        {WEEKDAYS.map(w => (
          <div key={w} className="px-2 py-2 text-center">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map(d => {
          const iso = localISO(d);
          const dayInstallments = byDate.get(iso) || [];
          const inMonth = d.getMonth() === month;
          const isToday = iso === today;
          const isSelected = iso === selectedDayISO;
          const totalAmount = dayInstallments.reduce((s, i) => s + Number(i.amount), 0);
          const total = dayInstallments.length;
          const receivedCount = dayInstallments.filter(i => i.isReceived).length;
          const allReceived = total > 0 && receivedCount === total;
          const someReceived = receivedCount > 0 && receivedCount < total;
          const noneReceived = total > 0 && receivedCount === 0;

          const baseCls = [
            'min-h-[88px] sm:min-h-[100px] p-1.5 border-t border-l border-border text-left flex flex-col gap-1',
            inMonth ? 'bg-card' : 'bg-muted/30',
            total > 0 ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default',
            isSelected ? 'ring-2 ring-primary ring-inset' : '',
            isToday ? 'bg-primary/5' : '',
          ].join(' ');

          let badgeCls = '';
          if (allReceived) badgeCls = 'bg-success/15 text-success';
          else if (noneReceived) badgeCls = 'bg-info/15 text-info';
          else if (someReceived) badgeCls = 'bg-warning/15 text-warning';

          return (
            <button
              key={iso}
              type="button"
              onClick={() => total > 0 && onDayClick(iso)}
              disabled={total === 0}
              className={baseCls}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${inMonth ? 'text-card-foreground' : 'text-muted-foreground/60'} ${isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground' : ''}`}>
                  {d.getDate()}
                </span>
                {total > 0 && allReceived && <CheckCircle2 className="w-3 h-3 text-success" />}
              </div>

              {total > 0 && (
                <div className={`mt-auto rounded px-1.5 py-1 text-[10px] font-semibold ${badgeCls}`}>
                  <div className="truncate">{formatCurrency(totalAmount)}</div>
                  {someReceived ? (
                    <div className="text-[9px] font-medium opacity-90">{receivedCount} de {total} recebidas</div>
                  ) : (
                    <div className="text-[9px] font-medium opacity-90">{total} parcela{total !== 1 ? 's' : ''}</div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FinanceiroCalendar;
