import { useMemo, useState } from 'react';
import { MAP_HEIGHT, MAP_WIDTH, STATES, project } from '@/lib/brazil-map';
import { STATUS_ORDER, countByStatus, type MapStatus, type RouteGroup } from '@/lib/route-map';
import { shortLabel, type Place } from '@/lib/places';

export const STATUS_COLOR: Record<MapStatus, string> = {
  fechado: 'hsl(var(--success))',
  negociacao: 'hsl(var(--warning))',
  aberto: 'hsl(var(--info))',
};

interface RouteMapProps {
  groups: RouteGroup[];
  /** Rota selecionada (id) ou null. */
  selected: string | null;
  /** Região selecionada (id) ou null: destaca só as rotas que passam por ela. */
  selectedPlace: string | null;
  onSelect: (routeId: string | null) => void;
  onSelectPlace: (placeId: string | null) => void;
}


type Zoom = 'auto' | 'brasil' | 'sudeste';

/** Recorte do Sudeste (onde ficam quase todas as rotas da Amitran): lon -51,5 a -38,5 e lat -25,5 a -14,5. */
const SE_TOP_LEFT = project(-51.5, -14.5);
const SE_BOTTOM_RIGHT = project(-38.5, -25.5);
const SUDESTE = { x: SE_TOP_LEFT[0], y: SE_TOP_LEFT[1], w: SE_BOTTOM_RIGHT[0] - SE_TOP_LEFT[0], h: SE_BOTTOM_RIGHT[1] - SE_TOP_LEFT[1] };
const BRASIL = { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT };

const inside = (x: number, y: number, v: typeof BRASIL) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Escolhe onde escrever o nome de cada ponto (em cima, embaixo, direita ou esquerda) sem cobrir outro nome. */
function placeLabels<T extends { id: string; x: number; y: number; short: string; r: number; priority: number }>(dots: T[], fontSize: number, view: typeof BRASIL) {
  const placed: Box[] = dots.map(d => ({ x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 }));
  const out = new Map<string, { x: number; y: number; anchor: 'start' | 'middle' | 'end' } | null>();
  for (const d of [...dots].sort((a, b) => b.priority - a.priority)) {
    const w = d.short.length * fontSize * 0.56 + 2;
    const h = fontSize * 1.1;
    const gap = d.r + fontSize * 0.25;
    const options: Array<{ box: Box; x: number; y: number; anchor: 'start' | 'middle' | 'end' }> = [
      { box: { x: d.x - w / 2, y: d.y - gap - h, w, h }, x: d.x, y: d.y - gap - h * 0.2, anchor: 'middle' },
      { box: { x: d.x - w / 2, y: d.y + gap, w, h }, x: d.x, y: d.y + gap + h * 0.8, anchor: 'middle' },
      { box: { x: d.x + gap, y: d.y - h / 2, w, h }, x: d.x + gap, y: d.y + h * 0.3, anchor: 'start' },
      { box: { x: d.x - gap - w, y: d.y - h / 2, w, h }, x: d.x - gap, y: d.y + h * 0.3, anchor: 'end' },
    ];
    const free = options.find(o => inside(o.box.x, o.box.y, view) && !placed.some(p => overlaps(o.box, p)));
    if (free) {
      placed.push(free.box);
      out.set(d.id, { x: free.x, y: free.y, anchor: free.anchor });
    } else {
      out.set(d.id, null); // sem espaço: o nome aparece ao passar o mouse
    }
  }
  return out;
}

/** Caminhãozinho (desenhado virado para a direita; é espelhado quando vai para o oeste). */
const Truck = ({ color, flip, scale }: { color: string; flip: boolean; scale: number }) => (
  <g transform={`scale(${flip ? -1.6 * scale : 1.6 * scale},${1.6 * scale})`} style={{ pointerEvents: 'none' }}>
    <rect x={-9} y={-6} width={11} height={8} rx={1.2} fill={color} stroke="hsl(var(--background))" strokeWidth={1} />
    <path d="M2.5,-3.5 h4 l2.5,3 v3 h-6.5 z" fill={color} stroke="hsl(var(--background))" strokeWidth={1} />
    <circle cx={-5} cy={3} r={1.9} fill="hsl(var(--card-foreground))" stroke="hsl(var(--background))" strokeWidth={0.7} />
    <circle cx={5} cy={3} r={1.9} fill="hsl(var(--card-foreground))" stroke="hsl(var(--background))" strokeWidth={0.7} />
  </g>
);

const RouteMap = ({ groups, selected, selectedPlace, onSelect, onSelectPlace }: RouteMapProps) => {
  const [zoom, setZoom] = useState<Zoom>('auto');
  // Um ponto por região, com quantas mudanças passam por ela.
  const dots = useMemo(() => {
    const byPlace = new Map<string, { place: Place; deals: RouteGroup['deals'] }>();
    for (const group of groups) {
      for (const place of [group.a, group.b]) {
        const entry = byPlace.get(place.id) ?? { place, deals: [] };
        entry.deals.push(...group.deals);
        byPlace.set(place.id, entry);
      }
    }
    return [...byPlace.values()].map(({ place, deals }) => {
      const [x, y] = project(place.lon, place.lat);
      const counts = countByStatus(deals);
      const best = STATUS_ORDER.find(s => counts[s] > 0) ?? 'aberto';
      return { id: place.id, x, y, short: shortLabel(place), full: place.label, total: deals.length, best, isHub: place.id === 'bh' };
    });
  }, [groups]);

  // Zoom automático: se quase tudo está no Sudeste, abre já aproximado.
  const autoSudeste = dots.length > 0 && dots.filter(d => inside(d.x, d.y, SUDESTE)).length / dots.length >= 0.6;
  const mode: 'brasil' | 'sudeste' = zoom === 'auto' ? (autoSudeste ? 'sudeste' : 'brasil') : zoom;
  const view = mode === 'sudeste' ? SUDESTE : BRASIL;
  // k encolhe desenhos (letras, bolinhas, linhas) quando aproximamos, para continuarem do mesmo tamanho na tela.
  const k = view.w / MAP_WIDTH;
  const fontSize = 14 * k;

  const sized = useMemo(
    () => dots.map(d => ({ ...d, r: (d.isHub ? 12 : 9) * k, priority: d.isHub ? 1e6 : d.total })),
    [dots, k],
  );
  const labels = useMemo(() => placeLabels(sized, fontSize, view), [sized, fontSize, view]);

  const lines = useMemo(() => {
    return groups.flatMap(group => {
      const [ax, ay] = project(group.a.lon, group.a.lat);
      const [bx, by] = project(group.b.lon, group.b.lat);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const present = STATUS_ORDER.filter(s => group.deals.some(d => d.status === s));
      return present.map((status, i) => {
        const items = group.deals.filter(d => d.status === status);
        // Uma curva por situação, abertas em leque para não ficarem uma em cima da outra.
        const bend = len * 0.16 + (i - (present.length - 1) / 2) * 16 * k;
        const cx = (ax + bx) / 2 + nx * bend;
        const cy = (ay + by) / 2 + ny * bend;
        return {
          key: `${group.routeId}-${status}`,
          routeId: group.routeId,
          aId: group.a.id,
          bId: group.b.id,
          status,
          count: items.length,
          hasIda: items.some(d => d.direction === 'ida'),
          hasVolta: items.some(d => d.direction === 'volta'),
          d: `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`,
          east: dx >= 0,
          len,
        };
      });
    });
  }, [groups, k]);

  const isDimmed = (routeId: string, aId: string, bId: string) => {
    if (selected) return selected !== routeId;
    if (selectedPlace) return selectedPlace !== aId && selectedPlace !== bId;
    return false;
  };

  return (
    <div className="relative">
    <div className="absolute right-1 top-1 z-10 flex gap-1 text-[11px]">
      {([['sudeste', 'Sudeste'], ['brasil', 'Brasil']] as Array<['sudeste' | 'brasil', string]>).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setZoom(id)}
          className={`px-2 py-1 rounded-md font-medium transition-colors ${mode === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground'}`}
        >
          {label}
        </button>
      ))}
    </div>
    <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="w-full h-auto select-none" role="img" aria-label="Mapa do Brasil com as rotas das mudanças">
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="transparent" onClick={() => { onSelect(null); onSelectPlace(null); }} />

      {STATES.map(s => (
        <path key={s.id} d={s.d} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
      ))}

      {lines.map(line => {
        const dim = isDimmed(line.routeId, line.aId, line.bId);
        const color = STATUS_COLOR[line.status];
        const duration = 5 + line.len / 55;
        return (
          <g key={line.key} opacity={dim ? 0.15 : 1}>
            <path d={line.d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={(1.6 + Math.min(line.count, 6) * 0.7) * k} strokeLinecap="round" strokeDasharray={line.status === 'aberto' ? `${7 * k} ${5 * k}` : undefined} />
            <path d={line.d} fill="none" stroke="transparent" strokeWidth={16 * k} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSelect(line.routeId); }} />
            {line.hasIda && (
              <g>
                <Truck color={color} flip={!line.east} scale={k} />
                <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={line.d} />
              </g>
            )}
            {line.hasVolta && (
              <g>
                <Truck color={color} flip={line.east} scale={k} />
                <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={line.d} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
              </g>
            )}
          </g>
        );
      })}

      {sized.map(dot => {
        const isSel = selectedPlace === dot.id;
        const dim = (selectedPlace && !isSel) || (selected && !groups.some(g => g.routeId === selected && (g.a.id === dot.id || g.b.id === dot.id)));
        const r = isSel ? dot.r * 1.2 : dot.r;
        const label = labels.get(dot.id);
        return (
          <g key={dot.id} opacity={dim ? 0.3 : 1} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSelectPlace(isSel ? null : dot.id); }}>
            <title>{`${dot.full}: ${dot.total} mudança${dot.total > 1 ? 's' : ''}`}</title>
            <circle cx={dot.x} cy={dot.y} r={r} fill={dot.isHub ? 'hsl(var(--primary))' : STATUS_COLOR[dot.best]} stroke="hsl(var(--background))" strokeWidth={2 * k} />
            <text x={dot.x} y={dot.y + fontSize * 0.33} textAnchor="middle" fontSize={fontSize * 0.85} fontWeight={700} fill="hsl(var(--background))" style={{ pointerEvents: 'none' }}>{dot.total}</text>
            {label && (
              <text x={label.x} y={label.y} textAnchor={label.anchor} fontSize={fontSize} fontWeight={dot.isHub ? 700 : 600} fill="hsl(var(--card-foreground))" stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{dot.short}</text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
};

export default RouteMap;
