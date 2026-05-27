import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchCashflowForecast } from '@/lib/installments';
import { formatCurrency } from '@/lib/crm-utils';
import {
  todayInSP,
  nextFifthBusinessDay,
  nextDay20,
  localISODate,
  formatDateShortBR,
} from '@/lib/cashflow';
import { CalendarClock, CalendarRange, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ForecastData {
  total: number;
  count: number;
  overdueCount: number;
}

interface Marker {
  key: 'fifth' | 'day20';
  label: string;
  icon: typeof CalendarClock;
  target: Date;
  data: ForecastData | null;
}

/**
 * Dois cards de previsão de caixa: entradas previstas até o próximo 5º dia
 * útil e até o próximo dia 20. Inclui parcelas atrasadas na soma; mostra
 * contagem de atrasadas em vermelho no sub-aviso.
 *
 * Filtro por seller: head vê tudo, vendedor vê só os deals dele. Auto-detecta
 * via useAuth — não precisa de prop.
 */
const CashflowForecastCards = () => {
  const { profile, isHead } = useAuth();
  const sellerId = useMemo(() => (isHead ? undefined : profile?.id), [isHead, profile?.id]);

  const today = useMemo(() => todayInSP(), []);
  const fifthTarget = useMemo(() => nextFifthBusinessDay(today), [today]);
  const day20Target = useMemo(() => nextDay20(today), [today]);

  const [fifth, setFifth] = useState<ForecastData | null>(null);
  const [day20, setDay20] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    const todayISO = localISODate(today);
    Promise.all([
      fetchCashflowForecast({ untilISO: localISODate(fifthTarget), todayISO, sellerId }),
      fetchCashflowForecast({ untilISO: localISODate(day20Target), todayISO, sellerId }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setFifth(a);
        setDay20(b);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'desconhecido';
        toast.error('Erro ao carregar previsão de caixa: ' + message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, sellerId, today, fifthTarget, day20Target]);

  const markers: Marker[] = [
    { key: 'fifth', label: 'Até 5º dia útil', icon: CalendarClock, target: fifthTarget, data: fifth },
    { key: 'day20', label: 'Até dia 20', icon: CalendarRange, target: day20Target, data: day20 },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {markers.map(m => (
        <div key={m.key} className="kpi-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {m.label} <span className="text-[10px] normal-case font-normal text-muted-foreground/70">({formatDateShortBR(m.target)})</span>
            </span>
            <m.icon className="w-4 h-4 text-info" />
          </div>
          <div className="text-2xl font-bold text-card-foreground">
            {loading || !m.data ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground text-base font-normal">
                <Loader2 className="w-4 h-4 animate-spin" /> carregando...
              </span>
            ) : (
              formatCurrency(m.data.total)
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {m.data ? (
              <>
                {m.data.count} lançamento{m.data.count === 1 ? '' : 's'}
                {m.data.overdueCount > 0 && (
                  <>
                    {' · '}
                    <span className="text-destructive font-semibold">
                      {m.data.overdueCount} atrasada{m.data.overdueCount === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
      ))}
    </div>
  );
};

export default CashflowForecastCards;
