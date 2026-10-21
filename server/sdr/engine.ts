import { isBusinessHoursBrt, mentionsPrice, sanitizeOutput, startOfDayBrt, type CleanOutput, type QualificationKey } from "./guards.js";
import { LlmError, type LlmMessage, type LlmProvider } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";
import type { SendResult } from "../whatsapp-send.js";
import { formatPhoneBr, phoneKey } from "../phone.js";

export interface SdrConfig {
  aiEnabled: boolean;
  mode: "shadow" | "auto";
}

export interface SdrConversation {
  id: string;
  wa_id: string;
  telefone_norm: string | null;
  status: "ai" | "human" | "paused";
  ai_enabled: boolean;
  assigned_seller_id: string | null;
  /** Negócio do funil já ligado a esta conversa (null = ainda não criado). */
  deal_id: string | null;
  qualification: Record<string, unknown> | null;
}

export interface HistoryMessage {
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human" | "system";
  type: string;
  content: string | null;
  status: string;
}

/** O que o motor precisa do banco (versão real em supabase-store.ts). */
export interface SdrStore {
  getConfig(): Promise<SdrConfig>;
  getConversation(id: string): Promise<SdrConversation | null>;
  /** Marca como "processadas" as mensagens pendentes do cliente. Devolve quantas. */
  claimPendingInbound(conversationId: string): Promise<number>;
  /** Últimas mensagens, da mais antiga para a mais nova. */
  getHistory(conversationId: string, limit: number): Promise<HistoryMessage[]>;
  insertAiMessage(input: {
    conversationId: string;
    content: string | null;
    status: "draft" | "sent" | "failed";
    error: string | null;
    whatsappMessageId: string | null;
    payload: Record<string, unknown>;
  }): Promise<void>;
  mergeQualification(conversationId: string, patch: Partial<Record<QualificationKey, string>>): Promise<void>;
  /** A conversa passa para atendimento humano (a IA sai de cena). */
  handoffToHuman(conversationId: string): Promise<void>;
  /** Desliga a IA para todo o CRM (chave inválida, sem saldo...). */
  disableAiGlobally(): Promise<void>;
  countAiMessagesSince(iso: string): Promise<number>;
  /** Procura um negócio ABERTO (nem fechado nem perdido) do mesmo telefone, para não duplicar. */
  findOpenDealByPhone(telefoneNorm: string): Promise<string | null>;
  /**
   * Cria o negócio no funil: etapa "Lead Novo", SEM valor e SEM tipo de serviço (isso é do humano).
   * Fica com o vendedor responsável da conversa ou, se não houver, com o Head. Devolve o id.
   */
  createDeal(input: {
    /** Conversa de origem: o dono é lido DE NOVO no banco na hora de criar (evita corrida com a atribuição). */
    conversationId: string;
    assignedSellerId: string | null;
    nome: string;
    telefone: string;
    origem: string;
    destino: string;
    dataMudancaIso: string | null;
  }): Promise<string>;
  linkDeal(conversationId: string, dealId: string): Promise<void>;
  /** Completa SÓ o que está vazio num negócio que já existia (data, origem, destino); nunca sobrescreve. */
  fillDealGaps(dealId: string, data: { origem?: string; destino?: string; dataMudancaIso?: string | null }): Promise<void>;
  /** Faz o dono do negócio ligado à conversa igual ao responsável atual da conversa (sem dono => Head). */
  syncDealOwner(conversationId: string): Promise<void>;
  /** Horário da mensagem mais recente do cliente (para detectar mensagem nova durante o processamento). */
  getLatestInboundAt(conversationId: string): Promise<string | null>;
  /** Próximo vendedor na vez (revezamento). null se não houver vendedores cadastrados. */
  pickNextSeller(): Promise<string | null>;
  /** Passa a conversa para o vendedor (o negócio criado em seguida nasce com ele). */
  assignConversation(conversationId: string, sellerId: string): Promise<void>;
}

/** Dados que o aviso ao vendedor precisa. */
export interface NewLeadInfo {
  sellerId: string;
  conversationId: string;
  nome: string;
  origem: string;
  destino: string;
  dataLabel: string;
}

/** Mensagem FIXA e segura (sem nenhuma palavra do filtro de preço) para quando a resposta da IA é barrada. */
export const PRICE_FALLBACK_REPLY = "Essa parte quem passa é o nosso consultor de vendas: ele monta o orçamento certinho e te responde em seguida. 😊";

/** Pedido de correção enviado à IA quando a primeira resposta cai no filtro de preço (uma única nova tentativa). */
export const priceRetryNote = (hit: string) =>
  `\n\nATENÇÃO — SUA RESPOSTA ANTERIOR FOI BARRADA: ela continha "${hit}", que é proibido. Escreva a resposta de novo SEM usar as palavras preço, valor, valores, custo, custa, reais, "R$", pagamento, parcela, desconto nem qualquer número de dinheiro. Se o cliente perguntou de dinheiro, diga apenas que o consultor de vendas monta o orçamento certinho e envia em seguida, e continue pedindo o que falta. Não repita a palavra que o cliente usou.`;

export interface SdrDeps {
  store: SdrStore;
  llm: LlmProvider;
  /** Só usado no modo automático. */
  send?: (conversation: SdrConversation, text: string) => Promise<SendResult>;
  /** O modo automático só vale se isto for true (trava extra: começa sempre em sombra). */
  allowAuto: boolean;
  dailyLimit: number;
  /** Cria o negócio no funil quando o lead fica qualificado. */
  createDeals: boolean;
  /**
   * Quem pode receber resposta AUTOMÁTICA (chaves de telefone). [] = ninguém; null = todos.
   * Os demais continuam só em rascunho, mesmo com o modo automático ligado.
   */
  autoAllowlist: string[] | null;
  /** Lead qualificado novo vai para um vendedor, em revezamento (em vez de ficar parado com o Head). */
  autoAssign?: boolean;
  /** Avisa o vendedor (WhatsApp). Falha aqui nunca derruba a conversa. O resultado vai para o registro da mensagem. */
  notifySeller?: (lead: NewLeadInfo) => Promise<{ outcome: string; error?: string } | void>;
  now?: () => number;
}

export type Outcome =
  | "skipped_global_off"
  | "skipped_conversation_off"
  | "skipped_not_ai"
  | "skipped_daily_limit"
  | "not_found"
  | "nothing_pending"
  | "superseded"
  | "discarded_changed"
  | "draft_saved"
  | "sent"
  | "send_failed"
  | "blocked_price"
  | "llm_error"
  | "llm_refused"
  | "invalid_output";

const HISTORY_LIMIT = 30;
// O WhatsApp aceita até ~4.096 caracteres por mensagem: cabe inteiro (antes cortava em 1.000).
const MAX_MESSAGE_CHARS = 4000;

/** Como a IA "enxerga" mensagens sem texto (ela não vê as imagens, só sabe que chegaram). */
const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: "[o cliente enviou uma foto]",
  video: "[o cliente enviou um vídeo]",
  audio: "[o cliente enviou um áudio]",
  document: "[o cliente enviou um documento]",
  sticker: "[o cliente enviou uma figurinha]",
  location: "[o cliente enviou uma localização]",
};

/** Esta conversa pode receber resposta automática? (lista de números liberados) */
export function isAutoAllowed(allowlist: string[] | null, conversation: Pick<SdrConversation, "telefone_norm" | "wa_id">): boolean {
  if (allowlist === null) return true;
  const key = phoneKey(conversation.telefone_norm || conversation.wa_id);
  return key !== "" && allowlist.includes(key);
}

/** Lead qualificado = nome, origem, destino e data + (lista dos bens OU ao menos 1 foto/vídeo). */
export function isQualified(q: Partial<Record<QualificationKey, string>>, mediaCount: number): boolean {
  return !!(q.nome && q.origem && q.destino && q.data_mudanca && (q.bens || mediaCount > 0));
}

/** Data de hoje em Brasília: por extenso (para a IA) e em AAAA-MM-DD. */
export function todayBrt(now: number): { label: string; iso: string } {
  const brt = new Date(now - 3 * 3600_000);
  const iso = brt.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(brt);
  return { label, iso };
}

const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * O primeiro nome do cliente apareceu numa das últimas `window` mensagens que a Carol ENVIOU?
 * (Trava de estilo: evita chamar o cliente pelo nome em toda mensagem, em qualquer modelo.)
 */
export function usedNameRecently(history: HistoryMessage[], fullName: string | undefined, window = 2): boolean {
  const first = plain((fullName ?? "").trim().split(/\s+/)[0] ?? "");
  if (first.length < 2) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
  const lastSent = history.filter((m) => m.direction === "outbound" && m.sender === "ai" && m.status !== "draft" && m.status !== "failed" && m.content).slice(-window);
  return lastSent.some((m) => pattern.test(plain(m.content as string)));
}

/** Quantas fotos/vídeos o cliente já mandou (conta como "lista dos bens"). */
export function countMedia(history: HistoryMessage[]): number {
  return history.filter((m) => m.direction === "inbound" && (m.type === "image" || m.type === "video")).length;
}

/** Transforma o histórico do banco no formato que a IA lê (cliente = user, nós = assistant). */
export function toLlmMessages(history: HistoryMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of history) {
    // Rascunhos e falhas nunca foram vistos pelo cliente: não entram na conversa.
    if (m.status === "draft" || m.status === "failed") continue;
    if (m.sender === "system") continue;

    const role: LlmMessage["role"] = m.direction === "inbound" ? "user" : "assistant";
    const placeholder = MEDIA_PLACEHOLDER[m.type] ?? "[mensagem sem texto]";
    const caption = m.content?.trim();
    // Foto/vídeo com legenda: mantém o aviso de que é mídia e acrescenta o que foi escrito.
    const full = caption ? (MEDIA_PLACEHOLDER[m.type] ? `${placeholder} ${caption}` : caption) : placeholder;
    // Se mesmo assim passar do limite, a IA é avisada (para não achar que o cliente parou no meio).
    const text = full.length > MAX_MESSAGE_CHARS ? `${full.slice(0, MAX_MESSAGE_CHARS)} [... mensagem muito longa, cortada pelo sistema]` : full;

    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  // A API exige começar por "user".
  while (out.length > 0 && out[0].role !== "user") out.shift();
  return out;
}

export interface TurnInput {
  known: Partial<Record<QualificationKey, string>>;
  /** Histórico no formato do banco (usado para contar fotos e saber se o nome acabou de ser usado). */
  history: HistoryMessage[];
  messages: LlmMessage[];
  today: { label: string; iso: string };
  businessHours: boolean;
}

export interface TurnResult {
  output: CleanOutput | null;
  refusal: boolean;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/**
 * Um "turno" da IA: monta as instruções, pergunta ao modelo, limpa a resposta e, se ela cair no
 * filtro de preço, pede UMA nova versão. É o MESMO caminho para a conversa real e para o simulador.
 */
export async function generateTurn(llm: LlmProvider, input: TurnInput): Promise<TurnResult> {
  const { known, history, messages, today, businessHours } = input;
  const system = buildSystemPrompt(known, {
    mediaCount: countMedia(history),
    today,
    businessHours,
    avoidName: usedNameRecently(history, known.nome),
    qualified: isQualified(known, countMedia(history)),
  });
  const result = await llm.generate({ system, messages });
  let usage = result.usage;
  let model = result.model;
  if (result.refusal) return { output: null, refusal: true, usage, model };

  let output = sanitizeOutput(result.output, today.iso);
  // Se a resposta caiu no filtro de preço, pede UMA nova versão sem as palavras proibidas
  // (em vez de deixar o cliente sem resposta). Se a nova também for barrada, o filtro depois bloqueia.
  const firstHit = output?.reply ? mentionsPrice(output.reply) : null;
  if (output && firstHit) {
    const retry = await llm.generate({ system: system + priceRetryNote(firstHit), messages });
    usage = { inputTokens: usage.inputTokens + retry.usage.inputTokens, outputTokens: usage.outputTokens + retry.usage.outputTokens };
    model = retry.model || model;
    if (!retry.refusal) {
      const retried = sanitizeOutput(retry.output, today.iso);
      if (retried) output = retried;
    }
  }
  return { output, refusal: false, usage, model };
}

/**
 * Processa UMA conversa: lê o que o cliente mandou, pede à IA um rascunho + dados do lead e
 * grava o resultado. Todas as travas de segurança passam por aqui.
 */
export async function processConversation(deps: SdrDeps, conversationId: string): Promise<Outcome> {
  const { store, llm } = deps;
  const now = deps.now ?? Date.now;

  // 1) Interruptores: global, da conversa e "quem está atendendo".
  const config = await store.getConfig();
  if (!config.aiEnabled) return "skipped_global_off";

  const conversation = await store.getConversation(conversationId);
  if (!conversation) return "not_found";
  if (!conversation.ai_enabled) return "skipped_conversation_off";
  if (conversation.status !== "ai") return "skipped_not_ai";

  // 2) Teto diário (protege o saldo).
  if ((await store.countAiMessagesSince(startOfDayBrt(now()))) >= deps.dailyLimit) return "skipped_daily_limit";

  // 3) "Reserva" as mensagens pendentes (evita que dois processos respondam a mesma coisa).
  if ((await store.claimPendingInbound(conversationId)) === 0) return "nothing_pending";

  // Marca qual era a última mensagem do cliente no começo: se chegar outra enquanto a IA pensa,
  // esta resposta é descartada (o processamento da mensagem nova responde com a conversa completa).
  const latestAtStart = await store.getLatestInboundAt(conversationId);

  const today = todayBrt(now());
  const known = toKnown(conversation.qualification);
  const history = await store.getHistory(conversationId, HISTORY_LIMIT);
  const messages = toLlmMessages(history);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return "nothing_pending";

  // 4) Pergunta à IA.
  let output: CleanOutput | null;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let model = "";
  try {
    const turn = await generateTurn(llm, { known, history, messages, today, businessHours: isBusinessHoursBrt(now()) });
    usage = turn.usage;
    model = turn.model;
    if (turn.refusal) {
      await failAndHandoff(store, conversationId, "A IA recusou responder esta conversa", usage, model);
      return "llm_refused";
    }
    output = turn.output;
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : "other";
    const reason = err instanceof LlmError ? err.message : "Falha inesperada ao consultar a IA";
    // Chave inválida ou sem saldo: desliga a IA para todos e avisa na própria conversa.
    if (kind === "auth" || kind === "billing") {
      await store.disableAiGlobally();
      await failAndHandoff(store, conversationId, `IA desligada automaticamente: ${reason}`, null, model);
    } else {
      await failAndHandoff(store, conversationId, reason, null, model);
    }
    return "llm_error";
  }

  if (!output) {
    await failAndHandoff(store, conversationId, "A IA devolveu uma resposta fora do formato esperado", usage, model);
    return "invalid_output";
  }

  // 5) Re-checagem otimista: durante os segundos da IA, alguém pode ter assumido ou desligado.
  const [freshConfig, fresh] = await Promise.all([store.getConfig(), store.getConversation(conversationId)]);
  if (!freshConfig.aiEnabled || !fresh || !fresh.ai_enabled || fresh.status !== "ai") return "discarded_changed";
  if ((await store.getLatestInboundAt(conversationId)) !== latestAtStart) return "superseded";

  // 6) Dados do lead: só campos permitidos (já filtrados em sanitizeOutput).
  if (Object.keys(output.qualification).length > 0) {
    await store.mergeQualification(conversationId, output.qualification);
  }

  // 6b) Lead qualificado => cria (ou liga a um já existente) o negócio no funil. Falha aqui nunca
  //     derruba a conversa: o rascunho segue normalmente.
  let deal: "created" | "linked" | null = null;
  let notify: { outcome: string; error?: string } | null = null;
  if (deps.createDeals && !fresh.deal_id) {
    const merged = { ...known, ...output.qualification };
    if (isQualified(merged, countMedia(history))) {
      try {
        const result = await createOrLinkDeal(store, fresh, merged, !!deps.autoAssign);
        deal = result.kind;
        if (result.kind === "created" && result.sellerId && deps.notifySeller) {
          try {
            const notified = await deps.notifySeller({
              sellerId: result.sellerId,
              conversationId,
              nome: merged.nome as string,
              origem: merged.origem as string,
              destino: merged.destino as string,
              dataLabel: merged.data_mudanca as string,
            });
            if (notified) notify = notified;
          } catch (err) {
            notify = { outcome: "exception", error: err instanceof Error ? err.message.slice(0, 200) : "erro" };
            console.error("[sdr] não consegui avisar o vendedor:", err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.error("[sdr] não consegui criar o negócio:", err instanceof Error ? err.message : err);
      }
    }
  }

  const payload = { model, usage, handoff: output.handoff, handoff_reason: output.handoffReason, deal, notify };

  // 7) Filtro de preço: a IA NUNCA fala de valores. Se falou, bloqueia e passa para humano.
  const priceHit = output.reply ? mentionsPrice(output.reply) : null;
  if (output.reply && priceHit) {
    await store.insertAiMessage({
      conversationId,
      content: output.reply,
      status: "failed",
      error: `Bloqueada pelo filtro de preço ("${priceHit}"). A conversa passou para um humano.`,
      whatsappMessageId: null,
      payload,
    });
    // Em modo automático, o cliente não fica no vazio: vai uma mensagem fixa e segura, e a equipe assume.
    const autoNow = config.mode === "auto" && deps.allowAuto && !!deps.send && isAutoAllowed(deps.autoAllowlist, conversation);
    if (autoNow) {
      try {
        const sent = await (deps.send as NonNullable<SdrDeps["send"]>)(conversation, PRICE_FALLBACK_REPLY);
        if (sent.ok && sent.wamid) {
          await store.insertAiMessage({
            conversationId,
            content: PRICE_FALLBACK_REPLY,
            status: "sent",
            error: null,
            whatsappMessageId: sent.wamid,
            payload: { ...payload, fixed_reply: "price_fallback" },
          });
        }
      } catch (err) {
        console.error("[sdr] não consegui enviar a mensagem fixa:", err instanceof Error ? err.message : err);
      }
    }
    await store.handoffToHuman(conversationId);
    return "blocked_price";
  }

  // 8) Sem texto para o cliente: só registra o encaminhamento, se houver.
  if (!output.reply) {
    if (output.handoff) await store.handoffToHuman(conversationId);
    return "draft_saved";
  }

  // 9) Modo sombra (padrão): só guarda como rascunho. Modo automático: envia.
  const auto = config.mode === "auto" && deps.allowAuto && !!deps.send && isAutoAllowed(deps.autoAllowlist, conversation);
  let outcome: Outcome = "draft_saved";

  if (!auto) {
    await store.insertAiMessage({
      conversationId,
      content: output.reply,
      status: "draft",
      error: null,
      whatsappMessageId: null,
      payload,
    });
  } else {
    const sent = await (deps.send as NonNullable<SdrDeps["send"]>)(conversation, output.reply);
    if (sent.ok && sent.wamid) {
      await store.insertAiMessage({ conversationId, content: output.reply, status: "sent", error: null, whatsappMessageId: sent.wamid, payload });
      outcome = "sent";
    } else if (sent.unconfirmed) {
      // A Meta só demorou a responder: a mensagem costuma chegar ao cliente. Não derruba a Carol nem passa para humano;
      // se não chegou, o cliente escreve de novo e a Carol responde.
      await store.insertAiMessage({
        conversationId,
        content: output.reply,
        status: "sent",
        error: null,
        whatsappMessageId: null,
        payload: { ...payload, send_unconfirmed: true },
      });
      outcome = "sent";
    } else {
      await store.insertAiMessage({
        conversationId,
        content: output.reply,
        status: "failed",
        error: sent.error ?? "Falha no envio",
        whatsappMessageId: null,
        payload,
      });
      await store.handoffToHuman(conversationId);
      return "send_failed";
    }
  }

  if (output.handoff) await store.handoffToHuman(conversationId);
  return outcome;
}

/** Liga a conversa a um negócio aberto do mesmo telefone ou cria um novo (sem valor nem tipo de serviço). */
async function createOrLinkDeal(
  store: SdrStore,
  conversation: SdrConversation,
  q: Partial<Record<QualificationKey, string>>,
  autoAssign: boolean,
): Promise<{ kind: "created" | "linked"; sellerId: string | null }> {
  const phoneNorm = conversation.telefone_norm || conversation.wa_id;

  const existing = await store.findOpenDealByPhone(phoneNorm);
  if (existing) {
    await store.linkDeal(conversation.id, existing);
    // O negócio já existia (ex.: criado à mão): completa o que faltava nele com o que a conversa descobriu.
    try {
      await store.fillDealGaps(existing, { origem: q.origem, destino: q.destino, dataMudancaIso: q.data_iso ?? null });
    } catch (err) {
      console.error("[sdr] não consegui completar o negócio existente:", err instanceof Error ? err.message : err);
    }
    return { kind: "linked", sellerId: null };
  }

  // Lead novo sem dono: vai para o próximo vendedor da vez (se alguém já foi escolhido, respeita).
  let sellerId = conversation.assigned_seller_id;
  if (!sellerId && autoAssign) {
    const next = await store.pickNextSeller();
    if (next) {
      await store.assignConversation(conversation.id, next);
      sellerId = next;
    }
  }

  const dealId = await store.createDeal({
    conversationId: conversation.id,
    assignedSellerId: sellerId,
    nome: q.nome as string,
    telefone: formatPhoneBr(phoneNorm),
    origem: q.origem as string,
    destino: q.destino as string,
    dataMudancaIso: q.data_iso ?? null,
  });
  await store.linkDeal(conversation.id, dealId);
  // Se o Head trocou o responsável por esses segundos, o negócio acompanha.
  await store.syncDealOwner(conversation.id);
  return { kind: "created", sellerId };
}

async function failAndHandoff(
  store: SdrStore,
  conversationId: string,
  reason: string,
  usage: { inputTokens: number; outputTokens: number } | null,
  model: string,
) {
  await store.insertAiMessage({
    conversationId,
    content: null,
    status: "failed",
    error: reason,
    whatsappMessageId: null,
    payload: { model, usage },
  });
  await store.handoffToHuman(conversationId);
}

function toKnown(q: Record<string, unknown> | null): Partial<Record<QualificationKey, string>> {
  const known: Partial<Record<QualificationKey, string>> = {};
  if (!q) return known;
  for (const [key, value] of Object.entries(q)) {
    if (typeof value === "string" && value) known[key as QualificationKey] = value;
  }
  return known;
}
