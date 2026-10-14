import type { SendResult, WhatsappConfig } from "./whatsapp-send.js";

export type MediaKind = "image" | "video" | "audio" | "document";

/**
 * Limite de tamanho aceito HOJE por envio (a Vercel limita o corpo a ~4,5 MB). Arquivos maiores
 * precisam de um armazenamento intermediário (fase futura).
 */
export const MAX_UPLOAD_BYTES = 4_000_000;

/** Limites do próprio WhatsApp, por tipo (bytes). */
const WHATSAPP_LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export interface Classification {
  ok: boolean;
  kind?: MediaKind;
  /** Código HTTP sugerido quando !ok. */
  status?: number;
  message?: string;
}

/** Decide se o arquivo pode ser enviado pelo WhatsApp e como (foto, vídeo, áudio ou documento). */
export function classifyUpload(mime: string, size: number, maxBytes: number = MAX_UPLOAD_BYTES): Classification {
  const type = mime.split(";")[0].trim().toLowerCase();
  let kind: MediaKind | null = null;

  if (type === "image/jpeg" || type === "image/png") kind = "image";
  else if (type === "video/mp4" || type === "video/3gpp") kind = "video";
  else if (["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"].includes(type)) kind = "audio";
  else if (DOCUMENT_TYPES.has(type)) kind = "document";

  if (!kind) {
    return {
      ok: false,
      status: 415,
      message: "Tipo de arquivo não aceito. Use foto (JPG/PNG), vídeo (MP4), áudio, PDF, Word, Excel, PowerPoint ou texto.",
    };
  }
  if (size <= 0) return { ok: false, status: 400, message: "O arquivo está vazio." };
  if (size > maxBytes) {
    return { ok: false, status: 413, message: "Arquivo grande demais: por enquanto o limite é de 4 MB por envio." };
  }
  if (size > WHATSAPP_LIMITS[kind]) {
    return { ok: false, status: 413, message: "Arquivo acima do limite do WhatsApp para este tipo." };
  }
  return { ok: true, kind };
}

const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
const TIMEOUT_MS = 30_000;

function endpoint(config: WhatsappConfig, path: string): string | null {
  const base = (config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  if (!base.startsWith("https://") || !config.phoneNumberId) return null;
  return `${base}/${config.apiVersion || DEFAULT_API_VERSION}/${config.phoneNumberId}/${path}`;
}

export interface UploadResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
}

/** Envia o arquivo para o WhatsApp e devolve o ID da mídia (usado depois na mensagem). */
export async function uploadWhatsappMedia(
  config: WhatsappConfig,
  file: { bytes: ArrayBuffer; mime: string; filename: string },
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  const url = endpoint(config, "media");
  if (!config.accessToken || !url) return { ok: false, error: "Envio de mídia não configurado no servidor" };

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mime);
  form.append("file", new Blob([file.bytes], { type: file.mime }), file.filename);

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: describe(config, res.status, json) };
    const id = json?.id;
    if (typeof id !== "string" || !id) return { ok: false, error: "Resposta do WhatsApp sem ID da mídia" };
    return { ok: true, mediaId: id };
  } catch {
    return { ok: false, error: "Falha de rede ao enviar o arquivo" };
  }
}

/** Envia uma mensagem de mídia já enviada (pelo ID). Nunca lança erro. */
export async function sendWhatsappMedia(
  config: WhatsappConfig,
  input: { to: string; kind: MediaKind; mediaId: string; caption?: string | null; filename?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const url = endpoint(config, "messages");
  if (!config.accessToken || !url) return { ok: false, error: "Envio de mídia não configurado no servidor" };

  const media: Record<string, unknown> = { id: input.mediaId };
  if (input.caption && input.kind !== "audio") media.caption = input.caption;
  if (input.kind === "document" && input.filename) media.filename = input.filename;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: input.kind,
        [input.kind]: media,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: describe(config, res.status, json) };
    const wamid = json?.messages?.[0]?.id;
    if (typeof wamid !== "string" || !wamid) return { ok: false, error: "Resposta do WhatsApp sem ID de mensagem" };
    return { ok: true, wamid };
  } catch {
    return { ok: false, error: "Falha de rede ao enviar a mensagem" };
  }
}

/** Mensagem curta de erro, sem dados do cliente e sem o token. */
function describe(config: WhatsappConfig, status: number, json: any): string {
  const e = json?.error;
  const detail = [e?.code, e?.error_data?.details ?? e?.message].filter(Boolean).join(" · ");
  const text = `WhatsApp recusou (HTTP ${status})${detail ? `: ${detail}` : ""}`;
  return (config.accessToken ? text.split(config.accessToken).join("[oculto]") : text).slice(0, 500);
}
