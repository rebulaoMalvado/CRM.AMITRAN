export const MIN_PASSWORD_LENGTH = 8;

/** Confere a senha nova antes de mandar ao servidor. Devolve a mensagem de erro, ou null se estiver tudo certo. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== confirm) return 'As duas senhas não são iguais.';
  return null;
}

/** Traduz os erros mais comuns do Supabase para português simples. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('password') && (m.includes('same') || m.includes('different'))) return 'Escolha uma senha diferente da atual.';
  if (m.includes('weak') || m.includes('pwned') || m.includes('at least')) return 'Senha fraca demais. Misture letras, números e um símbolo.';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (m.includes('expired') || m.includes('invalid')) return 'Link inválido ou vencido. Peça um novo.';
  return message;
}
