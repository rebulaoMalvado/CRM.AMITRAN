import { z } from "zod/v4";

/**
 * Campos que a IA PODE preencher. Qualquer outra chave que ela devolver é descartada.
 * (Lista fixa: a IA nunca escolhe onde escrever.)
 */
export const QUALIFICATION_KEYS = ["nome", "origem", "destino", "data_mudanca", "data_iso", "bens"] as const;
export type QualificationKey = (typeof QUALIFICATION_KEYS)[number];

/** Formato que pedimos à IA (sem limites de tamanho: eles são aplicados em sanitizeOutput). */
export const llmOutputSchema = z.object({
  reply: z.string().nullable(),
  handoff: z.boolean(),
  handoff_reason: z.string().nullable(),
  qualification: z.object({
    nome: z.string().nullable(),
    origem: z.string().nullable(),
    destino: z.string().nullable(),
    data_mudanca: z.string().nullable(),
    data_iso: z.string().nullable(),
    bens: z.string().nullable(),
  }),
});
export type LlmOutput = z.infer<typeof llmOutputSchema>;

const MAX_LEN: Record<QualificationKey, number> = {
  nome: 80,
  origem: 200,
  destino: 200,
  data_mudanca: 60,
  data_iso: 10,
  bens: 600,
};
const MAX_REPLY = 900;

export interface CleanOutput {
  reply: string | null;
  handoff: boolean;
  handoffReason: string | null;
  /** Só chaves permitidas, só valores não vazios, com tamanho limitado. */
  qualification: Partial<Record<QualificationKey, string>>;
}

/**
 * Valida (de novo, no nosso código) a saída da IA e deixa só o que é permitido gravar.
 * Devolve null se a saída não tem a forma esperada.
 */
/** "AAAA-MM-DD" que existe de verdade no calendário e, se `today` vier, não está no passado. */
export function isValidIsoDate(value: string, today?: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return today ? value >= today : true;
}

/** "2026-10-20" -> "20/10/2026" (formato de data do Brasil; o ano evita confusão com janeiro do ano que vem). */
export function formatIsoDateBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function sanitizeOutput(raw: unknown, today?: string): CleanOutput | null {
  const parsed = llmOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const out = parsed.data;

  const qualification: Partial<Record<QualificationKey, string>> = {};
  for (const key of QUALIFICATION_KEYS) {
    const value = out.qualification[key];
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_LEN[key]);
    if (text) qualification[key] = text;
  }

  // A data em formato de calendário só vale se for uma data real e futura (senão, descarta).
  if (qualification.data_iso && !isValidIsoDate(qualification.data_iso, today)) delete qualification.data_iso;
  // Com uma data real, a anotação (conversa, aviso ao vendedor, lead) mostra a data de calendário
  // (ex.: 20/10/2026) e não "terça que vem". Sem data específica, fica o que o cliente disse.
  if (qualification.data_iso) qualification.data_mudanca = formatIsoDateBr(qualification.data_iso);

  const reply = out.reply?.trim().slice(0, MAX_REPLY) || null;
  return {
    reply,
    handoff: out.handoff,
    handoffReason: out.handoff_reason?.trim().slice(0, 200) || null,
    qualification,
  };
}

// ---------------------------------------------------------------------------------------
// FILTRO DE PREÇO — regra da empresa: a IA nunca fala de valores. O prompt pede isso, mas só o
// código garante: se o texto sugerir preço/pagamento, o rascunho é BLOQUEADO e a conversa
// passa para um humano. Prefere errar para o lado de bloquear.
// ---------------------------------------------------------------------------------------
const PRICE_PATTERNS: RegExp[] = [
  /r\s?\$/i,
  /\breais\b|\breal\b/i,
  /\bpre[cç]os?\b/i,
  /\bvalor(es)?\b/i,
  /\bcust(a|am|ar|o|os|aria|ando)\b/i,
  /\bbarat[oa]s?\b/i,
  /\bcaro\b|\bcaros\b/i,
  /\bdesconto/i,
  /\bpromo[cç][aã]o|\bpromo[cç][oõ]es/i,
  /\bpix\b/i,
  /\bparcel/i,
  /\bcart[aã]o\b/i,
  /\bboleto\b/i,
  /\bpagamento|\bpagar\b|\bpago\b/i,
  /\b\d[\d.,]*\s?(mil|k)\b/i,
  /\b\d{3,}[.,]?\d*\s?(conto|pila|paus?)\b/i,
  /\bem\s+m[eé]dia\s+(de\s+)?\d/i,
];

/** Devolve o trecho que acionou o filtro, ou null se o texto está limpo. */
export function mentionsPrice(text: string): string | null {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern) ?? plain.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Início do dia em horário de Brasília (UTC-3, sem horário de verão), em ISO — para o limite diário. */
export function startOfDayBrt(now: number): string {
  const brt = new Date(now - 3 * 3600_000);
  const day = brt.toISOString().slice(0, 10);
  return `${day}T03:00:00.000Z`;
}

/**
 * Horário comercial da Amitran: segunda a sexta, das 08:00 às 18:00 (Brasília, UTC-3).
 * Não considera feriados (nesses dias a Carol age como em horário comercial).
 */
export function isBusinessHoursBrt(now: number): boolean {
  const brt = new Date(now - 3 * 3600_000);
  const weekday = brt.getUTCDay(); // 0 = domingo ... 6 = sábado
  const hour = brt.getUTCHours();
  return weekday >= 1 && weekday <= 5 && hour >= 8 && hour < 18;
}
