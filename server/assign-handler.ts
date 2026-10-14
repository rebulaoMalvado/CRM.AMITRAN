import { z } from "zod";
import type { AuthUser } from "./send-handler.js";

/** O que a atribuição precisa do banco (versão real em supabase-store.ts). */
export interface AssignStore {
  /** Papel do usuário-alvo, ou null se ele não existir no CRM. */
  getProfileRole(userId: string): Promise<"head" | "vendedor" | null>;
  conversationExists(id: string): Promise<boolean>;
  setAssignedSeller(conversationId: string, sellerId: string | null): Promise<void>;
}

export interface AssignDeps {
  authenticate: (jwt: string) => Promise<AuthUser | null>;
  store: AssignStore;
}

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  /** null = devolver a conversa para "sem dono". */
  seller_id: z.string().uuid().nullable(),
});

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * POST /api/whatsapp/assign — o Head passa uma conversa para um vendedor (ou tira o dono).
 * Regra de negócio: lead novo do WhatsApp nasce sem dono e SÓ o Head distribui.
 */
export async function handleAssign(request: Request, deps: AssignDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);

  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);
  if (user.role !== "head") return json({ error: "sem_permissao", message: "Só o Head pode distribuir conversas." }, 403);

  let parsed: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) return json({ error: "dados_invalidos", message: "Informe a conversa e o vendedor." }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400);
  }

  if (!(await deps.store.conversationExists(parsed.conversation_id))) {
    return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);
  }

  if (parsed.seller_id) {
    const role = await deps.store.getProfileRole(parsed.seller_id);
    if (!role) return json({ error: "vendedor_nao_encontrado", message: "Vendedor não encontrado." }, 404);
  }

  await deps.store.setAssignedSeller(parsed.conversation_id, parsed.seller_id);
  return json({ ok: true }, 200);
}
