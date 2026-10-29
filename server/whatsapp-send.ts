/** Configuração do envio — tudo vem de variáveis de ambiente do servidor (cofre da Vercel). */
export interface WhatsappConfig {
  /** Token permanente do "usuário do sistema" (SEGREDO — nunca em log, nunca no frontend). */
  accessToken?: string;
  /** ID do número que envia (não é segredo). */
  phoneNumberId?: string;
  /** Versão da Graph API (padrão v25.0). */
  apiVersion?: string;
  /**
   * Endereço base da API. Padrão: https://graph.facebook.com (Meta direto).
   * Com o Dualhook: https://api.dualhook.com (e o "token" passa a ser a chave dh_live_...).
   */
  apiBaseUrl?: string;
}

/** Resultado simples (sem união) para compilar igual no modo estrito e no modo da Vercel. */
export interface SendResult {
  ok: boolean;
  /** ID da mensagem na Meta (quando ok). */
  wamid?: string;
  /** Motivo curto da falha (quando !ok). */
  error?: string;
  /**
   * true = a Meta não respondeu a tempo (não recusou). A mensagem pode ter sido entregue mesmo assim
   * (aconteceu com a Carol: o cliente respondeu à saudação que o CRM marcou como "falhou").
   */
  unconfirmed?: boolean;
}

const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 700;

/**
 * Envia uma mensagem de TEXTO pela Cloud API da Meta.
 * Só funciona dentro da janela de 24h (a checagem da janela é feita antes, no handler).
 * Nunca lança erro: devolve { ok:false } com um motivo curto (sem token, sem dados do cliente).
 */
export async function sendWhatsappText(
  config: WhatsappConfig,
  input: { to: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  return postMessage(
    config,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.body, preview_url: false },
    },
    fetchImpl,
  );
}

/**
 * Envia uma mensagem-MODELO (template) aprovada pela Meta. É a única forma de iniciar conversa
 * fora da janela de 24h. Os parâmetros preenchem {{1}}, {{2}}... do corpo do modelo, na ordem.
 */
export async function sendWhatsappTemplate(
  config: WhatsappConfig,
  input: { to: string; name: string; language: string; bodyParams: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  return postMessage(
    config,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: input.bodyParams.length
          ? [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) }]
          : [],
      },
    },
    fetchImpl,
  );
}

async function postMessage(config: WhatsappConfig, payload: Record<string, unknown>, fetchImpl: typeof fetch): Promise<SendResult> {
  if (!config.accessToken || !config.phoneNumberId) {
    return { ok: false, error: "Envio de WhatsApp não configurado no servidor" };
  }

  const version = config.apiVersion || DEFAULT_API_VERSION;
  const base = (config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  if (!base.startsWith("https://")) {
    return { ok: false, error: "Endereço da API de WhatsApp inválido (precisa ser https)" };
  }
  const url = `${base}/${version}/${config.phoneNumberId}/messages`;

  // Falha de rede (sem resposta da Meta) tem uma 2ª tentativa: costuma ser um tropeço de conexão de 1 segundo.
  // Timeout NÃO repete: a mensagem pode ter saído, e repetir mandaria em dobro.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const json = (await res.json().catch(() => null)) as any;

      if (!res.ok) {
        const e = json?.error;
        const detail = [e?.code, e?.error_data?.details ?? e?.message].filter(Boolean).join(" · ");
        const text = `Meta recusou o envio (HTTP ${res.status})${detail ? `: ${detail}` : ""}`;
        // Defesa extra: se um dia a Meta ecoar o token numa mensagem de erro, ele não sai daqui
        // (troca ANTES de cortar o tamanho, para não sobrar pedaço do token na borda).
        return { ok: false, error: text.split(config.accessToken).join("[oculto]").slice(0, 500) };
      }

      const wamid = json?.messages?.[0]?.id;
      if (typeof wamid !== "string" || !wamid) {
        return { ok: false, error: "Resposta da Meta sem ID de mensagem" };
      }
      return { ok: true, wamid };
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (timedOut) return { ok: false, error: "A Meta demorou demais para responder", unconfirmed: true };
      // Fica no log da Vercel (sem token) para descobrir a causa quando a falha se repetir.
      const code = (err as { cause?: { code?: string } })?.cause?.code ?? "";
      const msg = (err instanceof Error ? err.message : String(err)).split(config.accessToken).join("[oculto]").slice(0, 150);
      console.error(`[whatsapp] falha de rede (tentativa ${attempt}/${MAX_ATTEMPTS}): ${err instanceof Error ? err.name : "erro"} ${code} ${msg}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      return { ok: false, error: "Falha de rede ao falar com a Meta" };
    }
  }
  return { ok: false, error: "Falha de rede ao falar com a Meta" };
}
