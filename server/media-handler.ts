import { z } from "zod";
import type { AuthUser } from "./send-handler.js";
import { fetchWhatsappMedia, type MediaFetchResult } from "./whatsapp-media.js";
import type { WhatsappConfig } from "./whatsapp-send.js";

export interface MediaStore {
  getMessage(messageId: string): Promise<{ conversation_id: string; type: string; payload: Record<string, any> | null } | null>;
  getConversationAccess(conversationId: string): Promise<{ assigned_seller_id: string | null } | null>;
}

export interface MediaDeps {
  config: WhatsappConfig;
  authenticate: (jwt: string) => Promise<AuthUser | null>;
  store: MediaStore;
  fetchMedia?: (config: WhatsappConfig, mediaId: string) => Promise<MediaFetchResult>;
}

const MEDIA_TYPES = new Set(["image", "sticker", "video", "audio", "document"]);
const querySchema = z.object({ message: z.string().uuid() });

/**
 * Tipos que o navegador pode exibir com segurança. Qualquer outro (HTML, SVG, scripts...) vira
 * download genérico: a mídia vem de terceiros e é servida no mesmo endereço do CRM.
 */
const SAFE_TYPE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp|webm|quicktime)|audio\/(ogg|mpeg|mp4|aac|amr|webm|x-m4a)|application\/pdf)(;.*)?$/i;

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * GET /api/whatsapp/media?message=<id da mensagem> — devolve a foto/vídeo/áudio/documento de UMA
 * mensagem, se o usuário tiver acesso à conversa (vendedor: só as dele; Head: todas).
 */
export async function handleMedia(request: Request, deps: MediaDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  const parsed = querySchema.safeParse({ message: new URL(request.url).searchParams.get("message") });
  if (!parsed.success) return json({ error: "dados_invalidos", message: "Informe a mensagem." }, 400);

  const message = await deps.store.getMessage(parsed.data.message);
  const conversation = message ? await deps.store.getConversationAccess(message.conversation_id) : null;
  // Sem permissão responde igual a "não existe" (não revela que a mensagem existe).
  if (!message || !conversation || (user.role !== "head" && conversation.assigned_seller_id !== user.id)) {
    return json({ error: "nao_encontrada", message: "Mídia não encontrada." }, 404);
  }

  if (!MEDIA_TYPES.has(message.type)) return json({ error: "sem_midia", message: "Esta mensagem não tem mídia." }, 404);
  const info = message.payload?.[message.type] as { id?: unknown; mime_type?: unknown } | undefined;
  const mediaId = typeof info?.id === "string" ? info.id : "";
  if (!mediaId) return json({ error: "sem_midia", message: "Esta mensagem não tem mídia." }, 404);

  const result = await (deps.fetchMedia ?? ((c, id) => fetchWhatsappMedia(c, id)))(deps.config, mediaId);
  if (!result.ok || !result.body) {
    const expired = result.status === 404 || result.status === 400;
    return json(
      {
        error: expired ? "midia_expirada" : "midia_indisponivel",
        message: expired ? "A mídia expirou (o WhatsApp guarda por cerca de 14 dias)." : "Não foi possível carregar a mídia agora.",
      },
      expired ? 410 : 502,
    );
  }

  const declared = typeof info?.mime_type === "string" ? info.mime_type : "";
  const upstream = result.contentType ?? "";
  const type = [declared, upstream].find((t) => SAFE_TYPE.test(t)) ?? "application/octet-stream";
  const safe = SAFE_TYPE.test(type);

  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-disposition": safe ? "inline" : "attachment",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (result.contentLength) headers["content-length"] = result.contentLength;
  return new Response(result.body, { status: 200, headers });
}
