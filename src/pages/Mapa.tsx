import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Link2, Loader2, LogOut, Repeat } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import RouteMap, { STATUS_COLOR } from '@/components/crm/RouteMap';
import { fetchMapDeals, type MapDealData } from '@/lib/whatsapp-api';
import { formatCurrency } from '@/lib/crm-utils';
import {
  STATUS_LABEL,
  STATUS_ORDER,
  buildMapData,
  countByStatus,
  findMatches,
  routeLabel,
  todayISO,
  type MapDeal,
  type MapStatus,
  type NoRouteReason,
} from '@/lib/route-map';
import { shortLabel, type Place } from '@/lib/places';

const formatDay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : 'sem data');

const short = (place: Place) => shortLabel(place);

const NO_ROUTE_TEXT: Record<NoRouteReason, string> = {
  origem: 'não reconheci a origem',
  destino: 'não reconheci o destino',
  ambos: 'não reconheci origem nem destino',
  'mesmo-estado': 'origem e destino no mesmo estado, sem as cidades',
};

const StatusPill = ({ status }: { status: MapStatus }) => (
  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-card-foreground">
    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
    {STATUS_LABEL[status]}
  </span>
);

const DealLine = ({ item }: { item: MapDeal }) => (
  <li className="py-1.5 border-t border-border first:border-t-0 text-xs">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="font-medium text-card-foreground">{item.deal.nome}</span>
      <StatusPill status={item.status} />
      <span className="text-muted-foreground">{short(item.from)} → {short(item.to)}</span>
      <span className={item.badDate ? 'text-destructive' : 'text-muted-foreground'}>{item.badDate ? 'data inválida' : formatDay(item.date)}</span>
      {item.deal.valor > 0 ? <span className="text-muted-foreground">{formatCurrency(item.deal.valor)}</span> : null}
      {item.deal.sellerName ? <span className="text-muted-foreground">· {item.deal.sellerName}</span> : null}
    </div>
    <div className="text-[11px] text-muted-foreground/80 truncate" title={`${item.deal.origem} → ${item.deal.destino}`}>
      {item.deal.origem || '—'} → {item.deal.destino || '—'}
    </div>
  </li>
);

type Tab = 'casamentos' | 'rotas' | 'semrota';

const Mapa = () => {
  const { profile, isHead, signOut } = useAuth();
  const [deals, setDeals] = useState<MapDealData[]>([]);
  const [lost, setLost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [windowDays, setWindowDays] = useState(15);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('casamentos');

  // O mapa mostra as mudanças de TODOS os vendedores (o servidor entrega só o que o mapa precisa).
  useEffect(() => {
    fetchMapDeals()
      .then(res => {
        setDeals(res.deals);
        setLost(res.lost);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Não foi possível carregar o mapa.'))
      .finally(() => setLoading(false));
  }, []);

  const today = todayISO();
  const data = useMemo(
    () => buildMapData(deals.map(d => ({ ...d, sellerName: d.sellerName ?? undefined })), today, lost),
    [deals, today, lost],
  );
  const matches = useMemo(() => findMatches(data.groups, windowDays), [data.groups, windowDays]);
  const selectedGroup = data.groups.find(g => g.routeId === selected) ?? null;
  const placeGroups = selectedPlace ? data.groups.filter(g => g.a.id === selectedPlace || g.b.id === selectedPlace) : data.groups;
  const placeLabel = selectedPlace ? short((data.groups.flatMap(g => [g.a, g.b]).find(p => p.id === selectedPlace)) as Place) : '';
  const totals = useMemo(() => countByStatus(data.groups.flatMap(g => g.deals)), [data.groups]);

  const selectRoute = (routeId: string | null) => {
    setSelected(routeId);
    setSelectedPlace(null);
    if (routeId) setTab('rotas');
  };
  const selectPlace = (placeId: string | null) => {
    setSelectedPlace(placeId);
    setSelected(null);
    if (placeId) setTab('rotas');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Voltar ao funil">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Mapa de rotas</h1>
              <p className="text-[11px] text-muted-foreground">{profile?.name} · {isHead ? 'Head de Vendas' : 'Vendedor'}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {STATUS_ORDER.map(s => (
            <span key={s} className="flex items-center gap-1.5 text-card-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}: <strong>{totals[s]}</strong>
            </span>
          ))}
          <span className="text-muted-foreground">
            Fora do mapa: {data.excluded.lost} perdidos · {data.excluded.past} com data passada · {data.excluded.sameRegion} dentro da mesma região
          </span>
          {data.badDates > 0 && <span className="text-destructive">{data.badDates} com data inválida (corrija no lead)</span>}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive py-8 text-center">{error}</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 items-start">
            <section className="bg-card border border-border rounded-xl p-3">
              <RouteMap groups={data.groups} selected={selected} selectedPlace={selectedPlace} onSelect={selectRoute} onSelectPlace={selectPlace} />
              <p className="text-[11px] text-muted-foreground mt-2">
                Todas as mudanças da equipe aparecem aqui, de todos os vendedores. As cidades são agrupadas por região (ex.: Joinville e Blumenau = Norte de SC) e a posição é aproximada. Linha tracejada = em aberto. Clique numa rota ou numa região para ver as mudanças.
              </p>
            </section>

            <section className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {([
                  ['casamentos', `Casamentos (${matches.length})`],
                  ['rotas', `Rotas (${data.groups.length})`],
                  ['semrota', `Sem rota (${data.noRoute.length})`],
                ] as Array<[Tab, string]>).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'casamentos' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Mudanças na mesma rota com datas a até</span>
                    <select
                      value={windowDays}
                      onChange={e => setWindowDays(Number(e.target.value))}
                      className="px-2 py-1 text-xs bg-muted border border-border rounded-md text-card-foreground"
                    >
                      {[7, 15, 30].map(d => <option key={d} value={d}>{d} dias</option>)}
                    </select>
                    <span>uma da outra.</span>
                  </div>

                  {matches.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4">Nenhuma possibilidade de casamento com essa janela. Tente aumentar os dias.</p>
                  )}

                  {matches.map(m => {
                    const counts = countByStatus(m.deals);
                    return (
                      <div key={`${m.routeId}-${m.from}`} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button className="text-sm font-semibold text-card-foreground hover:underline" onClick={() => selectRoute(m.routeId)}>
                            {routeLabel(m.a, m.b)}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {m.deals.length} mudanças · {formatDay(m.from)} a {formatDay(m.to)} ({m.spanDays === 0 ? 'mesmo dia' : `${m.spanDays} dias`})
                          </span>
                          {m.roundTrip && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              <Repeat className="w-3 h-3" /> ida e volta
                            </span>
                          )}
                          {counts.fechado > 0 && counts.fechado < m.deals.length && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/15 text-success">
                              <Link2 className="w-3 h-3" /> já tem fechada: falta casar o resto
                            </span>
                          )}
                        </div>
                        <ul className="mt-2">
                          {m.deals.map(item => <DealLine key={item.deal.id} item={item} />)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === 'rotas' && (
                <div className="space-y-2">
                  {selectedGroup ? (
                    <div className="rounded-lg border border-primary/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-card-foreground">{routeLabel(selectedGroup.a, selectedGroup.b)}</h3>
                        <button className="text-xs text-muted-foreground underline" onClick={() => selectRoute(null)}>ver todas</button>
                      </div>
                      <ul className="mt-2">
                        {selectedGroup.deals.map(item => <DealLine key={item.deal.id} item={item} />)}
                      </ul>
                    </div>
                  ) : placeGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">Nenhuma mudança em andamento com rota reconhecida.</p>
                  ) : (
                    <>
                      {selectedPlace && (
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>Rotas que passam por <strong className="text-card-foreground">{placeLabel}</strong></span>
                          <button className="underline" onClick={() => selectPlace(null)}>ver todas</button>
                        </div>
                      )}
                      {placeGroups.map(group => {
                        const counts = countByStatus(group.deals);
                        return (
                          <button
                            key={group.routeId}
                            onClick={() => selectRoute(group.routeId)}
                            className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/60 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-card-foreground">{routeLabel(group.a, group.b)}</span>
                              <span className="text-xs text-muted-foreground">{group.deals.length} mudança{group.deals.length > 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-muted-foreground">
                              {STATUS_ORDER.filter(s => counts[s] > 0).map(s => (
                                <span key={s} className="flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                                  {counts[s]} {STATUS_LABEL[s].toLowerCase()}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {tab === 'semrota' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Mudanças em andamento em que não deu para reconhecer a rota pelo endereço. Abra o lead e escreva a cidade e o estado (ex.: "Curitiba - PR") na origem e no destino para ela entrar no mapa.
                  </p>
                  {data.noRoute.length === 0 && <p className="text-sm text-muted-foreground py-2">Todas as mudanças têm rota.</p>}
                  <ul>
                    {data.noRoute.map(({ deal, reason }) => (
                      <li key={deal.id} className="text-xs py-1.5 border-t border-border first:border-t-0">
                        <span className="font-medium text-card-foreground">{deal.nome}</span>
                        <span className="text-muted-foreground"> · {deal.origem || '—'} → {deal.destino || '—'}</span>
                        <div className="text-[11px] text-muted-foreground/80">
                          {NO_ROUTE_TEXT[reason]}{deal.sellerName ? ` · ${deal.sellerName}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default Mapa;
