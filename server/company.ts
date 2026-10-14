/**
 * Tudo que é específico da EMPRESA fica aqui (nome, assistente, serviços, horário, tabelas).
 * Para o prompt da assistente só entra o que o dono da empresa confirmou: nada de inventar fatos.
 */
export const COMPANY = {
  /** Nome da empresa como a assistente e as mensagens falam. */
  name: "Amitran Mudanças",
  /** Nome da assistente de IA que atende o WhatsApp. */
  assistantName: "Carol",
  /** Serviços que a assistente PODE afirmar (confirmados pelo Lucas em 2026-10-14). */
  servicesText: "embalagem completa, desmontagem e montagem de móveis e seguro",
  /** Frase sobre a cobertura que a assistente PODE afirmar. */
  coverageText: "atendemos todo o Brasil",
  /** Horário comercial (a regra em código está em guards.ts: isBusinessHoursBrt). */
  businessHoursText: "segunda a sexta, das 8h às 18h",
  /** Início do nome do arquivo PDF da proposta. */
  proposalFilePrefix: "Proposta Amitran",
  /** HTML da proposta (fica em /public do site). */
  proposalTemplatePath: "/templates/proposta-amitran.html",
} as const;

/** Tabelas do CRM que existem com nomes diferentes de uma empresa para outra. */
export const TABLES = {
  deals: "deals",
  profiles: "profiles",
} as const;

/**
 * Link do CRM nos avisos: variável CRM_PUBLIC_URL; sem ela, usa o endereço pelo qual a
 * requisição chegou (o mesmo domínio em que o webhook está cadastrado).
 */
export function crmBaseUrl(requestUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env.CRM_PUBLIC_URL || new URL(requestUrl).origin).replace(/\/+$/, "");
}

/**
 * Vendedores que entram no revezamento de leads (SDR_SELLER_POOL: ids de perfil separados por vírgula).
 * Sem a variável não há revezamento: o lead fica com o Head, que distribui à mão.
 */
export function parseSellerPool(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
