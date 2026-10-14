import type { WhatsappConfig } from "./whatsapp-send.js";

/** Resultado simples (sem união) para compilar igual no modo estrito e no da Vercel. */
export interface MediaFetchResult {
  ok: boolean;
  status?: number;
  error?: string;
  body?: ReadableStream<Uint8Array> | null;
  contentType?: string | null;
  contentLength?: string | null;
}

const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
const TIMEOUT_MS = 25_000;

/**
 * Baixa uma mídia recebida (foto, vídeo, áudio, documento) pelo ID que veio no webhook.
 * - Dualhook (https://api.dualhook.com): GET /{versão}/{id}/content, com a chave dh_live.
 * - Meta direto: 2 passos (GET /{id} devolve a URL; depois baixa a URL com o token).
 * O ID vem SEMPRE do nosso banco (nunca do navegador), e o token nunca sai do servidor.
 */
export async function fetchWhatsappMedia(
  config: WhatsappConfig,
  mediaId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MediaFetchResult> {
  if (!config.accessToken) return { ok: false, error: "Mídia não configurada no servidor" };
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(mediaId)) return { ok: false, error: "ID de mídia inválido" };

  const version = config.apiVersion || DEFAULT_API_VERSION;
  const base = (config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  if (!base.startsWith("https://")) return { ok: false, error: "Endereço da API inválido (precisa ser https)" };
  const headers = { authorization: `Bearer ${config.accessToken}` };

  try {
    if (base.includes("dualhook.com")) {
      const res = await fetchImpl(`${base}/${version}/${mediaId}/content`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      return toResult(res);
    }

    // Meta direto: primeiro descobre a URL temporária da mídia, depois baixa.
    const meta = await fetchImpl(`${base}/${version}/${mediaId}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!meta.ok) return { ok: false, status: meta.status, error: `A Meta não encontrou a mídia (HTTP ${meta.status})` };
    const info = (await meta.json().catch(() => null)) as { url?: string } | null;
    if (!info?.url || !info.url.startsWith("https://")) return { ok: false, error: "A Meta não devolveu o endereço da mídia" };
    return toResult(await fetchImpl(info.url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  } catch {
    return { ok: false, error: "Falha de rede ao buscar a mídia" };
  }
}

function toResult(res: Response): MediaFetchResult {
  if (!res.ok) return { ok: false, status: res.status, error: `Mídia indisponível (HTTP ${res.status})` };
  return {
    ok: true,
    status: res.status,
    body: res.body,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
  };
}
