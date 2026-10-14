import { z } from "zod";
import type { AuthUser } from "../send-handler.js";
import type { SimInput, SimResult } from "./simulate.js";

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function bearer(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

// ------------------------------------------------------------------------------------
// Interruptor GERAL da IA (kill switch) e modo — só o Head
// ------------------------------------------------------------------------------------
export interface SdrConfigStore {
  updateConfig(input: { aiEnabled?: boolean; mode?: "shadow" | "auto"; updatedBy: string }): Promise<void>;
}

const configSchema = z
  .object({ ai_enabled: z.boolean().optional(), mode: z.enum(["shadow", "auto"]).optional() })
  .refine((v) => v.ai_enabled !== undefined || v.mode !== undefined, { message: "nada para alterar" });

export async function handleSdrConfig(
  request: Request,
  deps: { authenticate: (jwt: string) => Promise<AuthUser | null>; store: SdrConfigStore; allowAuto: boolean },
): Promise<Response> {
  const jwt = bearer(request);
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);
  if (user.role !== "head") return json({ error: "sem_permissao", message: "Só o Head controla a IA." }, 403);

  let body: z.infer<typeof configSchema>;
  try {
    const parsed = configSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos", message: "Informe ai_enabled e/ou mode." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  if (body.mode === "auto" && !deps.allowAuto) {
    return json({ error: "modo_automatico_bloqueado", message: "O envio automático ainda não foi liberado. A IA só pode gerar rascunhos." }, 403);
  }

  await deps.store.updateConfig({ aiEnabled: body.ai_enabled, mode: body.mode, updatedBy: user.id });
  return json({ ok: true }, 200);
}

// ------------------------------------------------------------------------------------
// Interruptor da IA em UMA conversa — Head ou o vendedor responsável
// ------------------------------------------------------------------------------------
export interface SdrConversationStore {
  getAccess(conversationId: string): Promise<{ id: string; assigned_seller_id: string | null } | null>;
  /** ligar => ai_enabled = true e status "ai"; desligar => ai_enabled = false e status "human". */
  setConversationAi(conversationId: string, enabled: boolean): Promise<void>;
}

const conversationSchema = z.object({ conversation_id: z.string().uuid(), ai_enabled: z.boolean() });

export async function handleConversationAi(
  request: Request,
  deps: { authenticate: (jwt: string) => Promise<AuthUser | null>; store: SdrConversationStore },
): Promise<Response> {
  const jwt = bearer(request);
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  let body: z.infer<typeof conversationSchema>;
  try {
    const parsed = conversationSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos", message: "Informe a conversa e ai_enabled." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  const conversation = await deps.store.getAccess(body.conversation_id);
  if (!conversation || (user.role !== "head" && conversation.assigned_seller_id !== user.id)) {
    return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);
  }

  await deps.store.setConversationAi(conversation.id, body.ai_enabled);
  return json({ ok: true }, 200);
}

// ------------------------------------------------------------------------------------
// Teste do aviso ao vendedor (manda um aviso de mentira de verdade) — só o Head
// ------------------------------------------------------------------------------------
const testNotifySchema = z.object({ seller_id: z.string().uuid() });

export async function handleTestNotify(
  request: Request,
  deps: {
    authenticate: (jwt: string) => Promise<AuthUser | null>;
    notify: (sellerId: string) => Promise<{ outcome: string; error?: string }>;
  },
): Promise<Response> {
  const jwt = bearer(request);
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);
  if (user.role !== "head") return json({ error: "sem_permissao", message: "Só o Head pode testar o aviso." }, 403);

  let sellerId: string;
  try {
    const parsed = testNotifySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos", message: "Informe o seller_id." }, 400);
    sellerId = parsed.data.seller_id;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  const result = await deps.notify(sellerId);
  return json({ ok: result.outcome === "sent_text" || result.outcome === "sent_template", outcome: result.outcome, error: result.error ?? null }, 200);
}

// ------------------------------------------------------------------------------------
// Simulador da Carol (testar sem mexer em nada de verdade) — só o Head
// ------------------------------------------------------------------------------------
const simulateSchema = z.object({
  messages: z
    .array(
      z.object({
        from: z.enum(["customer", "victoria"]),
        type: z.enum(["text", "image"]),
        content: z.string().max(4000),
      }),
    )
    .min(1)
    .max(60),
  known: z.record(z.string(), z.string().max(500)).default({}),
  after_hours: z.boolean().optional(),
});

export async function handleSimulate(
  request: Request,
  deps: { authenticate: (jwt: string) => Promise<AuthUser | null>; run: (input: SimInput) => Promise<SimResult> },
): Promise<Response> {
  const jwt = bearer(request);
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);
  if (user.role !== "head") return json({ error: "sem_permissao", message: "Só o Head pode usar o simulador." }, 403);

  let body: z.infer<typeof simulateSchema>;
  try {
    const parsed = simulateSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos", message: "Conversa de teste inválida." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }
  // A última mensagem tem que ser do cliente (é a ela que a Carol vai responder).
  if (body.messages[body.messages.length - 1].from !== "customer") {
    return json({ error: "dados_invalidos", message: "A última mensagem precisa ser do cliente." }, 400);
  }

  const result = await deps.run({ messages: body.messages as SimInput["messages"], known: body.known as SimInput["known"], afterHours: body.after_hours });
  return json({ ok: true, ...result }, 200);
}
