import { z } from "zod";
import type { AuthUser } from "./send-handler.js";
import type { SdrStore } from "./sdr/engine.js";
import { formatPhoneBr } from "./phone.js";

/** O que "Gerar lead" precisa do banco (a versão real é o mesmo store da assistente). */
export type CreateLeadStore = Pick<
  SdrStore,
  "getConversation" | "findOpenDealByPhone" | "createDeal" | "linkDeal" | "fillDealGaps" | "syncDealOwner" | "assignConversation" | "handoffToHuman"
>;

export interface CreateLeadDeps {
  authenticate: (jwt: string) => Promise<AuthUser | null>;
  store: CreateLeadStore;
}

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(120),
  origem: z.string().trim().min(1).max(200),
  destino: z.string().trim().min(1).max(200),
  /** Data da mudança (AAAA-MM-DD), se já souberem. */
  data_mudanca: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * POST /api/whatsapp/create-lead — a equipe cria o lead no funil a partir de uma conversa,
 * sem esperar a Carol terminar as perguntas. Fica "Lead Novo", SEM valor e SEM tipo de serviço.
 */
export async function handleCreateLead(request: Request, deps: CreateLeadDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);

  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos", message: "Preencha nome, origem e destino." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  const conversation = await deps.store.getConversation(body.conversation_id);
  if (!conversation) return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);

  // Head pode tudo; vendedor só na conversa dele (ou numa sem dono, que passa a ser dele).
  const isOwner = conversation.assigned_seller_id === user.id;
  const unassigned = !conversation.assigned_seller_id;
  if (user.role !== "head" && !isOwner && !unassigned) {
    return json({ error: "sem_permissao", message: "Esta conversa é de outro vendedor." }, 403);
  }

  if (conversation.deal_id) {
    return json({ error: "ja_tem_negocio", message: "Esta conversa já tem um lead no funil." }, 409);
  }

  const phoneNorm = conversation.telefone_norm || conversation.wa_id;

  // Já existe negócio aberto desse telefone? Só liga, para não duplicar.
  const existing = await deps.store.findOpenDealByPhone(phoneNorm);
  if (existing) {
    await deps.store.linkDeal(conversation.id, existing);
    await deps.store.fillDealGaps(existing, { origem: body.origem, destino: body.destino, dataMudancaIso: body.data_mudanca ?? null });
    await deps.store.handoffToHuman(conversation.id);
    return json({ ok: true, deal_id: existing, linked: true }, 200);
  }

  // Vendedor que gera o lead de uma conversa sem dono fica com ela.
  let sellerId = conversation.assigned_seller_id;
  if (!sellerId && user.role === "vendedor") {
    await deps.store.assignConversation(conversation.id, user.id);
    sellerId = user.id;
  }

  const dealId = await deps.store.createDeal({
    conversationId: conversation.id,
    assignedSellerId: sellerId,
    nome: body.nome,
    telefone: formatPhoneBr(phoneNorm),
    origem: body.origem,
    destino: body.destino,
    dataMudancaIso: body.data_mudanca ?? null,
  });
  await deps.store.linkDeal(conversation.id, dealId);
  await deps.store.syncDealOwner(conversation.id);
  // A equipe assumiu: a Carol sai de cena nesta conversa.
  await deps.store.handoffToHuman(conversation.id);

  return json({ ok: true, deal_id: dealId, linked: false }, 200);
}
