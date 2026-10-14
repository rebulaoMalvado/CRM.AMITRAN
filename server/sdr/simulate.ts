import { PRICE_FALLBACK_REPLY, countMedia, generateTurn, isQualified, toLlmMessages, type HistoryMessage } from "./engine.js";
import { isBusinessHoursBrt, mentionsPrice, QUALIFICATION_KEYS, type QualificationKey } from "./guards.js";
import type { LlmProvider } from "./llm.js";

export interface SimMessage {
  from: "customer" | "victoria";
  type: "text" | "image";
  content: string;
}

export interface SimInput {
  messages: SimMessage[];
  /** O que a Carol já tinha anotado nas rodadas anteriores desta simulação. */
  known: Partial<Record<QualificationKey, string>>;
  /** Força "fora do horário" (true) ou "horário comercial" (false). Sem isso, vale o relógio de verdade. */
  afterHours?: boolean;
}

export interface SimResult {
  /** O que o cliente veria (já passou pelo filtro de preço). */
  reply: string | null;
  handoff: boolean;
  handoffReason: string | null;
  /** Dados anotados até agora (anteriores + os desta rodada). */
  qualification: Partial<Record<QualificationKey, string>>;
  /** Na vida real o sistema criaria o lead no funil agora. */
  leadWouldBeCreated: boolean;
  /** O filtro de preço barrou a resposta da IA (e foi trocada pela mensagem fixa). */
  blockedByPriceFilter: boolean;
  businessHours: boolean;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/** "Hoje" no fuso de Brasília, por extenso e em AAAA-MM-DD (igual ao da conversa real). */
function todayBrt(now: number): { label: string; iso: string } {
  const brt = new Date(now - 3 * 3600_000);
  const iso = brt.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(brt);
  return { label, iso };
}

/**
 * Simula UMA rodada da Carol sem tocar em nada: não grava no banco, não manda WhatsApp, não cria lead
 * nem avisa vendedor. Usa o MESMO prompt, modelo e travas da conversa real.
 */
export async function simulateTurn(llm: LlmProvider, input: SimInput, now: () => number = Date.now): Promise<SimResult> {
  const history: HistoryMessage[] = input.messages.map((m) => ({
    direction: m.from === "customer" ? "inbound" : "outbound",
    sender: m.from === "customer" ? "contact" : "ai",
    type: m.type,
    content: m.type === "image" ? null : m.content,
    status: m.from === "customer" ? "received" : "delivered",
  }));
  const messages = toLlmMessages(history);
  const businessHours = input.afterHours === undefined ? isBusinessHoursBrt(now()) : !input.afterHours;

  const turn = await generateTurn(llm, { known: input.known, history, messages, today: todayBrt(now()), businessHours });
  if (turn.refusal || !turn.output) {
    return {
      reply: null,
      handoff: true,
      handoffReason: turn.refusal ? "A IA recusou responder" : "Resposta fora do formato esperado",
      qualification: input.known,
      leadWouldBeCreated: false,
      blockedByPriceFilter: false,
      businessHours,
      usage: turn.usage,
      model: turn.model,
    };
  }

  const qualification: Partial<Record<QualificationKey, string>> = {};
  for (const key of QUALIFICATION_KEYS) {
    const value = turn.output.qualification[key] ?? input.known[key];
    if (value) qualification[key] = value;
  }

  const blocked = !!(turn.output.reply && mentionsPrice(turn.output.reply));
  return {
    reply: blocked ? PRICE_FALLBACK_REPLY : turn.output.reply,
    handoff: blocked ? true : turn.output.handoff,
    handoffReason: blocked ? "Filtro de preço" : turn.output.handoffReason,
    qualification,
    leadWouldBeCreated: isQualified(qualification, countMedia(history)),
    blockedByPriceFilter: blocked,
    businessHours,
    usage: turn.usage,
    model: turn.model,
  };
}
