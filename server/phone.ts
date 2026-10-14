/**
 * Normaliza o número que a Meta manda (wa_id) para ligar com deals.telefone.
 * O `wa_id` original continua guardado como veio (é ele que se usa para responder).
 *
 * Caso especial do Brasil: a Meta às vezes entrega celular SEM o 9º dígito
 * (55 + DDD + 8 dígitos). Aqui acrescentamos o 9 para ficar no formato atual.
 * Telefone fixo (começa com 2–5 depois do DDD) não é alterado.
 */
export function normalizePhone(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55") && /[6-9]/.test(digits[4])) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

/**
 * Chave para comparar telefones escritos de jeitos diferentes ("+55 31 98888-0001",
 * "(31) 98888-0001", "553188880001"...): só dígitos, com 55 e com o 9º dígito.
 */
export function phoneKey(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 ? normalizePhone(digits) : "";
}

/** 5531988880001 -> "+55 31 98888-0001" (mesmo formato dos telefones já usados nos negócios). */
export function formatPhoneBr(norm: string): string {
  const d = norm.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : norm;
}
