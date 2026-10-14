import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere se o corpo da requisição foi mesmo assinado pela Meta.
 * A Meta manda o header `X-Hub-Signature-256: sha256=<hex>`, que é o HMAC-SHA256
 * do corpo CRU (bytes exatos, sem reformatar) usando o "App Secret" do app.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;

  const received = Buffer.from(header.slice(prefix.length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();

  // timingSafeEqual exige o mesmo tamanho; tamanho diferente = assinatura inválida
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Comparação de textos em tempo constante (usada no token de verificação). */
export function safeEqualText(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
