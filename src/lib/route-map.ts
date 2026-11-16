import type { Deal } from '@/types/crm';
import { PLACES, resolvePlace, type Place } from '@/lib/places';

/** O mapa só precisa destes campos do negócio (vêm do servidor, de todos os vendedores). */
export type MapSourceDeal = Pick<Deal, 'id' | 'nome' | 'origem' | 'destino' | 'dataMudanca' | 'stage' | 'valor' | 'sellerName'>;

/**
 * Lógica do mapa de rotas: quais mudanças entram, em que situação estão e onde há possibilidade de
 * "casar" mudanças (mesma rota em datas próximas, ou ida + volta) para aproveitar o caminhão.
 * Tudo calculado no navegador, com os negócios que o servidor entrega. Nada é gravado.
 *
 * Diferente de uma rota fixa a partir de BH, aqui a rota é um PAR de regiões (origem ⇄ destino, em qualquer
 * sentido). BH só é a "ponta de referência" quando está na rota.
 */

export type MapStatus = 'fechado' | 'negociacao' | 'aberto';
export type Direction = 'ida' | 'volta';

export const STATUS_LABEL: Record<MapStatus, string> = {
  fechado: 'Fechado',
  negociacao: 'Em negociação',
  aberto: 'Em aberto',
};

/** Pior para melhor: o que já está fechado pesa mais na cor da rota. */
export const STATUS_ORDER: MapStatus[] = ['fechado', 'negociacao', 'aberto'];

export interface MapDeal {
  deal: MapSourceDeal;
  routeId: string;
  /** 'ida' = sai da 1ª ponta da rota (BH, quando está nela) para a 2ª; 'volta' = o contrário. */
  direction: Direction;
  from: Place;
  to: Place;
  status: MapStatus;
  /** AAAA-MM-DD ou '' (sem data ou data inválida). */
  date: string;
  /** A data digitada no lead é impossível (ex.: ano 12027). O lead fica no mapa, mas sem data. */
  badDate: boolean;
}

export interface RouteGroup {
  routeId: string;
  /** Pontas da rota: `a` é BH quando a rota passa por BH; senão, ordem alfabética do id. */
  a: Place;
  b: Place;
  deals: MapDeal[];
}

export interface Match {
  routeId: string;
  a: Place;
  b: Place;
  deals: MapDeal[];
  from: string;
  to: string;
  spanDays: number;
  /** Tem mudança indo e outra voltando na mesma rota: o caminhão não volta vazio. */
  roundTrip: boolean;
}

export type NoRouteReason = 'origem' | 'destino' | 'ambos' | 'mesmo-estado';

export interface NoRouteItem {
  deal: MapSourceDeal;
  reason: NoRouteReason;
}

export interface MapData {
  groups: RouteGroup[];
  /** Mudanças em andamento, mas sem rota reconhecida pelo endereço. */
  noRoute: NoRouteItem[];
  excluded: { lost: number; past: number; sameRegion: number };
  /** Quantas mudanças em andamento têm data impossível. */
  badDates: number;
  total: number;
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function statusOf(stage: MapSourceDeal['stage']): MapStatus | null {
  if (stage === 'fechado') return 'fechado';
  if (stage === 'negociacao' || stage === 'orcamento_enviado') return 'negociacao';
  if (stage === 'lead_novo' || stage === 'qualificacao') return 'aberto';
  return null; // perdido
}

/** Data válida no formato AAAA-MM-DD e com ano plausível (nem 12027, nem 22026). */
export function cleanDate(raw: string, today: string): { date: string; bad: boolean } {
  const value = (raw ?? '').trim();
  if (!value) return { date: '', bad: false };
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const year = ok ? Number(value.slice(0, 4)) : 0;
  const thisYear = Number(today.slice(0, 4));
  if (!ok || year < thisYear - 5 || year > thisYear + 3) return { date: '', bad: true };
  return { date: value, bad: false };
}

export type RouteOf =
  | { kind: 'route'; a: Place; b: Place; from: Place; to: Place; routeId: string; direction: Direction }
  | { kind: 'local' }
  | { kind: 'unknown'; reason: NoRouteReason };

/** Reconhece a rota pelos textos de origem e destino. */
export function routeOf(deal: Pick<MapSourceDeal, 'origem' | 'destino'>): RouteOf {
  const from = resolvePlace(deal.origem);
  const to = resolvePlace(deal.destino);
  if (!from || !to) return { kind: 'unknown', reason: !from && !to ? 'ambos' : !from ? 'origem' : 'destino' };

  if (from.place.id === to.place.id) {
    // Mesma região conhecida (ex.: as duas pontas na Grande BH) = mudança local, fica fora do mapa.
    if (from.fromCity && to.fromCity) return { kind: 'local' };
    // Só sabemos o estado das duas pontas e é o mesmo: não dá para saber se é local ou viagem.
    return { kind: 'unknown', reason: 'mesmo-estado' };
  }

  const [a, b] = orderPair(from.place, to.place);
  return {
    kind: 'route',
    a,
    b,
    from: from.place,
    to: to.place,
    routeId: `${a.id}|${b.id}`,
    direction: from.place.id === a.id ? 'ida' : 'volta',
  };
}

/** BH vem sempre primeiro; no resto, ordem alfabética do id (só para a rota ter um sentido fixo). */
function orderPair(x: Place, y: Place): [Place, Place] {
  if (x.id === 'bh') return [x, y];
  if (y.id === 'bh') return [y, x];
  return x.id <= y.id ? [x, y] : [y, x];
}

export const routeLabel = (a: Place, b: Place) => `${a.id === 'bh' ? 'BH' : a.label} ⇄ ${b.label}`;

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function buildMapData(deals: MapSourceDeal[], today: string, lostFromServer = 0): MapData {
  const byRoute = new Map<string, RouteGroup>();
  const noRoute: NoRouteItem[] = [];
  const excluded = { lost: lostFromServer, past: 0, sameRegion: 0 };
  let total = 0;
  let badDates = 0;

  for (const deal of deals) {
    const status = statusOf(deal.stage);
    if (!status) {
      excluded.lost += 1;
      continue;
    }
    const { date, bad } = cleanDate(deal.dataMudanca, today);
    // Mudança com data anterior a hoje sai do mapa, seja qual for a situação (já aconteceu ou o lead ficou velho).
    if (date && date < today) {
      excluded.past += 1;
      continue;
    }
    const route = routeOf(deal);
    if (route.kind === 'local') {
      excluded.sameRegion += 1;
      continue;
    }
    if (route.kind === 'unknown') {
      noRoute.push({ deal, reason: route.reason });
      if (bad) badDates += 1;
      continue;
    }
    const item: MapDeal = { deal, routeId: route.routeId, direction: route.direction, from: route.from, to: route.to, status, date, badDate: bad };
    const group = byRoute.get(route.routeId) ?? { routeId: route.routeId, a: route.a, b: route.b, deals: [] };
    group.deals.push(item);
    byRoute.set(route.routeId, group);
    total += 1;
    if (bad) badDates += 1;
  }

  const groups = [...byRoute.values()]
    .map(group => ({ ...group, deals: group.deals.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999')) }))
    .sort((x, y) => y.deals.length - x.deals.length || x.routeId.localeCompare(y.routeId));

  return { groups, noRoute, excluded, badDates, total };
}

/**
 * Possíveis casamentos: na mesma rota, mudanças com datas a até `windowDays` dias uma da outra.
 * Só entram mudanças com data (as sem data não dá para casar).
 */
export function findMatches(groups: RouteGroup[], windowDays: number): Match[] {
  const matches: Match[] = [];
  for (const group of groups) {
    const dated = group.deals.filter(d => d.date);
    let cluster: MapDeal[] = [];
    const flush = () => {
      if (cluster.length >= 2) {
        const from = cluster[0].date;
        const to = cluster[cluster.length - 1].date;
        matches.push({
          routeId: group.routeId,
          a: group.a,
          b: group.b,
          deals: cluster,
          from,
          to,
          spanDays: dayNumber(to) - dayNumber(from),
          roundTrip: cluster.some(d => d.direction === 'ida') && cluster.some(d => d.direction === 'volta'),
        });
      }
      cluster = [];
    };
    for (const item of dated) {
      const last = cluster[cluster.length - 1];
      if (last && dayNumber(item.date) - dayNumber(last.date) > windowDays) flush();
      cluster.push(item);
    }
    flush();
  }
  // Ida e volta primeiro, depois os mais próximos da data de hoje.
  return matches.sort((x, y) => Number(y.roundTrip) - Number(x.roundTrip) || x.from.localeCompare(y.from));
}

export function countByStatus(items: MapDeal[]): Record<MapStatus, number> {
  const out: Record<MapStatus, number> = { fechado: 0, negociacao: 0, aberto: 0 };
  for (const i of items) out[i.status] += 1;
  return out;
}

export const placeById = (id: string): Place | undefined => PLACES[id];
