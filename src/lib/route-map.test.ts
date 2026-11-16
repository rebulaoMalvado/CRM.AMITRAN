import { describe, expect, it } from 'vitest';
import { resolvePlace } from './places';
import { buildMapData, cleanDate, countByStatus, findMatches, routeOf, statusOf, type MapSourceDeal } from './route-map';

const TODAY = '2026-11-16';

let n = 0;
function deal(over: Partial<MapSourceDeal>): MapSourceDeal {
  n += 1;
  return { id: `d${n}`, nome: `Cliente ${n}`, origem: 'Belo Horizonte', destino: 'Joinville - SC', dataMudanca: '2026-12-10', stage: 'lead_novo', valor: 0, sellerName: 'Gabriel', ...over };
}

const id = (text: string) => resolvePlace(text)?.place.id ?? null;

describe('resolvePlace (reconhece a região pelo texto)', () => {
  it('cidades da Grande BH viram uma região só', () => {
    for (const t of ['Belo Horizonte', 'BH', 'Contagem, bairro Industrial', 'Betim - MG', 'Nova Lima/MG', 'Sarzedo MG ']) expect(id(t)).toBe('bh');
  });

  it('cidades de uma mesma região do país casam entre si (Joinville, Blumenau e Pomerode são o mesmo lado)', () => {
    expect(id('Joinville-SC')).toBe('sc-norte');
    expect(id(' Pomerode SC')).toBe('sc-norte');
    expect(id('Blumenau, Santa Catarina')).toBe('sc-norte');
    expect(id('São João Batista - SC')).toBe('sc-norte');
  });

  it('vale a ÚLTIMA cidade citada (o endereço termina na cidade)', () => {
    expect(id('R. Grão Mogol, 1014 - Niterói, Betim - MG, 32672-082')).toBe('bh'); // Niterói é bairro de Betim
    expect(id('Rua Presidente Vargas, 726, Guarujá, Betim')).toBe('bh'); // Guarujá é bairro de Betim
    expect(id('Belo Horizonte (MG), último pedágio sentido Rio-BH na BR-040')).toBe('bh');
  });

  it('nome logo depois de rua/bairro/vila é ignorado', () => {
    expect(id('Rua São Paulo, 10')).toBeNull();
    expect(id('Bairro Ouro Preto, Belo Horizonte - MG')).toBe('bh');
    expect(id('Belo Horizonte - Bairro Ouro Preto')).toBe('bh');
    expect(id('Rua Pará, 188, Senhora das Graças, Betim')).toBe('bh');
  });

  it('cidade que existe em vários estados só vale se o estado for citado', () => {
    expect(id('São José/SC')).toBe('sc-floripa');
    expect(id('Serra, Espírito Santo')).toBe('es-vitoria');
    expect(id('Vila da Serra, Nova Lima')).toBe('bh');
    expect(id('Trindade, GO')).toBe('go-goiania');
    expect(id('Serra')).toBeNull();
    expect(id('Palmas')).toBeNull();
  });

  it('cidade desconhecida: usa o estado (sigla ou por extenso); sem nada, não reconhece', () => {
    const r = resolvePlace('Divinólandia de Minas - MG');
    expect(r?.place.id).toBe('mg-outras');
    expect(r?.fromCity).toBe(false);
    expect(id('Cidadezinha, Bahia')).toBe('ba-outras');
    expect(id('Santo Agostinho (1 andar)')).toBe('bh');
    expect(id('BRASIL TODO')).toBeNull();
    expect(id('')).toBeNull();
  });

  it('"AP 302" (apartamento) não vira o estado do Amapá', () => {
    expect(id('Rua das Flores, 100 AP 302')).toBeNull();
    expect(id('Alguma Cidade - AP')).toBe('ap');
  });

  it('erro de digitação conhecido: Pauapebas', () => {
    expect(id('Pauapebas PA')).toBe('pa-carajas');
  });
});

describe('routeOf', () => {
  it('BH sempre é a 1ª ponta; ida sai de BH e volta chega em BH', () => {
    const ida = routeOf({ origem: 'Belo Horizonte', destino: 'Curitiba' });
    const volta = routeOf({ origem: 'Água Verde, Curitiba', destino: 'Belo Horizonte' });
    expect(ida.kind === 'route' && ida.direction).toBe('ida');
    expect(volta.kind === 'route' && volta.direction).toBe('volta');
    expect(ida.kind === 'route' && ida.routeId).toBe('bh|pr-curitiba');
    expect(volta.kind === 'route' && volta.routeId).toBe('bh|pr-curitiba');
  });

  it('rota que não passa por BH também vale (Natal → Juiz de Fora)', () => {
    const r = routeOf({ origem: 'Natal', destino: 'Juiz de Fora' });
    expect(r.kind).toBe('route');
  });

  it('as duas pontas na mesma região conhecida = local; sem as duas pontas = sem rota', () => {
    expect(routeOf({ origem: 'Buritis, Belo Horizonte', destino: 'Jardim Canadá, Nova Lima' }).kind).toBe('local');
    expect(routeOf({ origem: 'Congonhas', destino: 'Congonhas' }).kind).toBe('local');
    expect(routeOf({ origem: '', destino: 'Curitiba' })).toEqual({ kind: 'unknown', reason: 'origem' });
    expect(routeOf({ origem: 'Curitiba', destino: 'BRASIL TODO' })).toEqual({ kind: 'unknown', reason: 'destino' });
    expect(routeOf({ origem: 'x', destino: 'y' })).toEqual({ kind: 'unknown', reason: 'ambos' });
  });

  it('só o estado nas duas pontas e igual: não dá para saber se é viagem (sem rota)', () => {
    expect(routeOf({ origem: 'Cidade A - MG', destino: 'Cidade B - MG' })).toEqual({ kind: 'unknown', reason: 'mesmo-estado' });
  });
});

describe('statusOf e cleanDate', () => {
  it('orçamento enviado conta como negociação; perdido sai', () => {
    expect(statusOf('fechado')).toBe('fechado');
    expect(statusOf('negociacao')).toBe('negociacao');
    expect(statusOf('orcamento_enviado')).toBe('negociacao');
    expect(statusOf('lead_novo')).toBe('aberto');
    expect(statusOf('qualificacao')).toBe('aberto');
    expect(statusOf('perdido')).toBeNull();
  });

  it('data com ano impossível (12027, 22026) é tratada como sem data, e marcada', () => {
    expect(cleanDate('2026-12-31', TODAY)).toEqual({ date: '2026-12-31', bad: false });
    expect(cleanDate('12027-02-10', TODAY)).toEqual({ date: '', bad: true });
    expect(cleanDate('22026-12-31', TODAY)).toEqual({ date: '', bad: true });
    expect(cleanDate('', TODAY)).toEqual({ date: '', bad: false });
  });
});

describe('buildMapData', () => {
  it('agrupa por rota e conta as situações', () => {
    const data = buildMapData([
      deal({ stage: 'fechado' }),
      deal({ stage: 'orcamento_enviado' }),
      deal({ destino: 'Curitiba', stage: 'lead_novo' }),
    ], TODAY);
    expect(data.total).toBe(3);
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0].routeId).toBe('bh|sc-norte');
    expect(countByStatus(data.groups[0].deals)).toEqual({ fechado: 1, negociacao: 1, aberto: 0 });
  });

  it('tira perdidos, datas passadas (de qualquer etapa) e mudanças locais; data de hoje fica', () => {
    const data = buildMapData([
      deal({ stage: 'perdido' }),
      deal({ stage: 'fechado', dataMudanca: '2026-11-15' }),
      deal({ stage: 'lead_novo', dataMudanca: '2026-11-10' }),
      deal({ stage: 'fechado', dataMudanca: TODAY }),
      deal({ destino: 'Contagem' }),
    ], TODAY, 5);
    expect(data.total).toBe(1);
    expect(data.excluded).toEqual({ lost: 6, past: 2, sameRegion: 1 });
  });

  it('lead sem data fica no mapa, mas não entra em casamento; data inválida é contada', () => {
    const data = buildMapData([deal({ dataMudanca: '' }), deal({ dataMudanca: '12027-02-10' }), deal({ dataMudanca: '2026-12-01' })], TODAY);
    expect(data.total).toBe(3);
    expect(data.badDates).toBe(1);
    expect(findMatches(data.groups, 30)).toHaveLength(0);
  });

  it('o que não tem rota vai para "sem rota", com o motivo', () => {
    const data = buildMapData([deal({ destino: 'BRASIL TODO' }), deal({ origem: '', destino: '' })], TODAY);
    expect(data.total).toBe(0);
    expect(data.noRoute.map(i => i.reason)).toEqual(['destino', 'ambos']);
  });
});

describe('findMatches', () => {
  it('junta mudanças da mesma rota com datas dentro da janela; fora dela, não', () => {
    const data = buildMapData([
      deal({ dataMudanca: '2026-12-01' }),
      deal({ destino: 'Blumenau - SC', dataMudanca: '2026-12-08' }),
      deal({ dataMudanca: '2026-12-20' }),
      deal({ destino: 'Curitiba', dataMudanca: '2026-12-01' }),
    ], TODAY);
    const seven = findMatches(data.groups, 7);
    expect(seven).toHaveLength(1);
    expect(seven[0].deals).toHaveLength(2);
    expect(seven[0].spanDays).toBe(7);
    expect(findMatches(data.groups, 30)[0].deals).toHaveLength(3);
  });

  it('ida e volta na mesma rota é marcado e vem primeiro', () => {
    const data = buildMapData([
      deal({ origem: 'Belo Horizonte', destino: 'Curitiba', dataMudanca: '2026-12-02' }),
      deal({ origem: 'Curitiba', destino: 'Belo Horizonte', dataMudanca: '2026-12-05' }),
      deal({ destino: 'Joinville', dataMudanca: '2026-11-20' }),
      deal({ destino: 'Pomerode', dataMudanca: '2026-11-21' }),
    ], TODAY);
    const matches = findMatches(data.groups, 15);
    expect(matches).toHaveLength(2);
    expect(matches[0].roundTrip).toBe(true);
    expect(matches[0].routeId).toBe('bh|pr-curitiba');
    expect(matches[1].roundTrip).toBe(false);
  });

  it('mudanças de vendedores diferentes casam entre si', () => {
    const data = buildMapData([
      deal({ sellerName: 'Raufle', dataMudanca: '2026-12-01' }),
      deal({ sellerName: 'Gabriel', dataMudanca: '2026-12-03' }),
    ], TODAY);
    const [match] = findMatches(data.groups, 7);
    expect(new Set(match.deals.map(d => d.deal.sellerName))).toEqual(new Set(['Raufle', 'Gabriel']));
  });
});
