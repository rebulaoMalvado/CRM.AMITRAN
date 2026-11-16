import type { AuthUser } from "./send-handler.js";

/**
 * Dados do MAPA DE ROTAS. Todo usuário logado (Head ou vendedor) vê as mudanças de TODOS: o mapa serve para achar
 * casamentos entre mudanças de vendedores diferentes. Por isso o servidor lê com a chave de serviço (o banco só
 * mostra a cada vendedor os negócios dele) e devolve SÓ o que o mapa precisa: nada de telefone, parceiro ou custos.
 */
export interface MapDealRow {
  id: string;
  nome: string;
  origem: string;
  destino: string;
  dataMudanca: string;
  stage: string;
  valor: number;
  sellerName: string | null;
}

export interface MapStore {
  /** Negócios fora da Lixeira que não estão perdidos + quantos perdidos existem (só o número). */
  listForMap(): Promise<{ deals: MapDealRow[]; lost: number }>;
}

export interface MapDeps {
  authenticate: (jwt: string) => Promise<AuthUser | null>;
  store: MapStore;
}

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** POST /api/whatsapp/assign?op=mapa */
export async function handleMapDeals(request: Request, deps: MapDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json({ error: "nao_autenticado", message: "Faça login." }, 401);
  const user = await deps.authenticate(jwt);
  if (!user) return json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401);

  const { deals, lost } = await deps.store.listForMap();
  return json({ ok: true, deals, lost }, 200);
}
