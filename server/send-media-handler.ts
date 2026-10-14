import { z } from "zod";
import type { ConversationRow, SendDeps } from "./send-handler.js";
import { classifyUpload, MAX_UPLOAD_BYTES, sendWhatsappMedia, uploadWhatsappMedia, type MediaKind, type UploadResult } from "./media-upload.js";
import type { SendResult, WhatsappConfig } from "./whatsapp-send.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Margem para o "envelope" do formulário (a Vercel limita o corpo total a ~4,5 MB).
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 300_000;

export interface SendMediaDeps extends Omit<SendDeps, "send"> {
  upload?: (config: WhatsappConfig, file: { bytes: ArrayBuffer; mime: string; filename: string }) => Promise<UploadResult>;
  sendMedia?: (
    config: WhatsappConfig,
    input: { to: string; kind: MediaKind; mediaId: string; caption?: string | null; filename?: string },
  ) => Promise<SendResult>;
}

const idSchema = z.string().uuid();

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * POST /api/whatsapp/send-media (multipart: conversation_id, file, caption opcional)
 * Um humano envia foto, vídeo, áudio ou documento. Mesmas regras do envio de texto:
 * login, vendedor só nas conversas dele (Head em qualquer uma), janela de 24h; a conversa passa a "human".
 */
export async function handleSendMedia(request: Request, deps: SendMediaDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login para enviar arquivos." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return json({ error: "arquivo_grande", message: "Arquivo grande demais: por enquanto o limite é de 4 MB por envio." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "dados_invalidos", message: "Envio inválido." }, 400);
  }

  const conversationId = idSchema.safeParse(form.get("conversation_id"));
  const file = form.get("file");
  if (!conversationId.success || !file || typeof file === "string") {
    return json({ error: "dados_invalidos", message: "Informe a conversa e o arquivo." }, 400);
  }
  const caption = String(form.get("caption") ?? "").trim().slice(0, 1024) || null;

  const bytes = await file.arrayBuffer();
  const mime = file.type || "";
  const filename = (file.name || "arquivo").replace(/[^\w.\- ()À-ÿ]/g, "_").slice(0, 120);

  const kind = classifyUpload(mime, bytes.byteLength);
  if (!kind.ok || !kind.kind) return json({ error: "arquivo_invalido", message: kind.message ?? "Arquivo inválido." }, kind.status ?? 400);

  const conversation: ConversationRow | null = await deps.store.getConversation(conversationId.data);
  if (!conversation || (user.role !== "head" && conversation.assigned_seller_id !== user.id)) {
    return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);
  }

  return deliverFile(deps, { user, conversation, kind: kind.kind, bytes, mime, filename, caption });
}

/** A janela de 24h do WhatsApp está aberta (cliente escreveu nas últimas 24h)? */
export function isWindowOpen(conversation: ConversationRow, now: number): boolean {
  const lastInbound = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : NaN;
  return !Number.isNaN(lastInbound) && now - lastInbound <= WINDOW_MS;
}

export const WINDOW_CLOSED_RESPONSE = () =>
  json(
    {
      error: "janela_24h_fechada",
      message: "Já se passaram mais de 24h desde a última mensagem do cliente. O WhatsApp só permite enviar arquivos dentro desse prazo.",
    },
    409,
  );

/**
 * Envia o arquivo para o cliente (janela de 24h, upload, mensagem), grava na conversa e passa a
 * conversa para "human". Usado pelo anexo manual e pelo envio da proposta em PDF.
 */
export async function deliverFile(
  deps: SendMediaDeps,
  input: { user: { id: string }; conversation: ConversationRow; kind: MediaKind; bytes: ArrayBuffer; mime: string; filename: string; caption: string | null },
): Promise<Response> {
  const { user, conversation, kind, bytes, mime, filename, caption } = input;
  const now = (deps.now ?? Date.now)();
  if (!isWindowOpen(conversation, now)) return WINDOW_CLOSED_RESPONSE();

  const failed = async (error: string) => {
    await deps.store.insertOutboundMessage({
      conversationId: conversation.id,
      userId: user.id,
      content: caption,
      whatsappMessageId: null,
      status: "failed",
      error,
      type: kind,
    });
    return json({ error: "falha_no_envio", message: error }, 502);
  };

  const uploaded = await (deps.upload ?? ((c, f) => uploadWhatsappMedia(c, f)))(deps.config, { bytes, mime, filename });
  if (!uploaded.ok || !uploaded.mediaId) return failed(uploaded.error ?? "Falha ao enviar o arquivo");

  const sent = await (deps.sendMedia ?? ((c, i) => sendWhatsappMedia(c, i)))(deps.config, {
    to: conversation.wa_id,
    kind,
    mediaId: uploaded.mediaId,
    caption,
    filename,
  });
  if (!sent.ok || !sent.wamid) return failed(sent.error ?? "Falha ao enviar a mensagem");

  await deps.store.insertOutboundMessage({
    conversationId: conversation.id,
    userId: user.id,
    content: caption,
    whatsappMessageId: sent.wamid,
    status: "sent",
    error: null,
    type: kind,
    // Guardamos o ID da mídia para a própria conversa conseguir exibir o arquivo depois.
    payload: { [kind]: { id: uploaded.mediaId, mime_type: mime.split(";")[0], filename, caption } },
  });
  await deps.store.markHumanReplied(conversation.id, new Date(now).toISOString());

  return json({ ok: true, whatsapp_message_id: sent.wamid, type: kind }, 200);
}
