/**
 * Helpers de fluxo de caixa: datas-âncora pro horário de Brasília e cálculo
 * de marcos clássicos (5º dia útil, dia 20).
 *
 * Decisões deliberadas:
 *  - Dia útil = seg-sex apenas. Não consideramos feriados (nacionais nem de
 *    SP) pra evitar dependência de lib de calendário. Lucas ajusta
 *    mentalmente quando o marco real cair em feriado.
 *  - Toda data é resolvida em America/Sao_Paulo independente do TZ do
 *    browser, pra evitar bug típico "à meia-noite UTC vira ontem no Brasil".
 */

const TZ = 'America/Sao_Paulo';

/** Data de "hoje" no horário de Brasília, normalizada pra meia-noite local. */
export function todayInSP(): Date {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** N-ésimo dia útil (seg-sex) de um mês. month é 0-indexed. */
export function nthBusinessDay(year: number, month: number, n: number): Date {
  const d = new Date(year, month, 1);
  let count = 0;
  // proteção contra loop infinito caso n seja absurdo — 31 dias max no mês
  for (let safety = 0; safety < 40; safety++) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    if (count === n) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    d.setDate(d.getDate() + 1);
  }
  throw new Error(`nthBusinessDay: não encontrou ${n}º dia útil em ${year}-${month + 1}`);
}

/**
 * Próximo 5º dia útil considerando "hoje".
 * Se hoje <= 5º útil deste mês → este mês. Senão → próximo mês.
 */
export function nextFifthBusinessDay(today: Date): Date {
  const thisMonth = nthBusinessDay(today.getFullYear(), today.getMonth(), 5);
  if (today.getTime() <= thisMonth.getTime()) return thisMonth;
  return nthBusinessDay(today.getFullYear(), today.getMonth() + 1, 5);
}

/**
 * Próximo dia 20 considerando "hoje".
 * Se hoje.dia <= 20 → este mês. Senão → próximo mês.
 */
export function nextDay20(today: Date): Date {
  if (today.getDate() <= 20) {
    return new Date(today.getFullYear(), today.getMonth(), 20);
  }
  return new Date(today.getFullYear(), today.getMonth() + 1, 20);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Converte Date local pra string ISO YYYY-MM-DD (sem timezone shift). */
export function localISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const MONTHS_ABBR_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Formata Date como "DD/mmm" (ex: "05/jun"). */
export function formatDateShortBR(d: Date): string {
  return `${pad2(d.getDate())}/${MONTHS_ABBR_PT[d.getMonth()]}`;
}
