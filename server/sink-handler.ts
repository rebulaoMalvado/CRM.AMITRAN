import { handleVerification, type WebhookEnv } from "./webhook-handler.js";

const MAX_DRAIN_BYTES = 4_000_000;

/**
 * Endereço "ralo" para as cópias que o Dualhook entrega (assinadas com a chave DELES, que nós
 * não temos). Tudo isso já chega validado pelo nosso próprio app da Meta, então aqui não se grava
 * nada: só se responde "ok" para a Meta parar de reenviar.
 *
 * - GET: responde à verificação da Meta (devolve o desafio se o token bater).
 * - POST: descarta o conteúdo e responde 200. NADA é lido, interpretado nem gravado.
 */
export function handleSinkVerification(request: Request, env: WebhookEnv): Response {
  return handleVerification(request, env);
}

export async function handleSinkDelivery(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared <= MAX_DRAIN_BYTES) {
    // Consome o corpo para fechar a conexão direito, sem usar o conteúdo.
    await request.arrayBuffer().catch(() => undefined);
  }
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}
