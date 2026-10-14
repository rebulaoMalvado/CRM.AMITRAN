import { z } from "zod";
import { safeEqualText } from "../signature.js";
import type { Outcome } from "./engine.js";

export interface ProcessDeps {
  /** Segredo interno (SDR_INTERNAL_SECRET): só o nosso próprio webhook conhece. */
  secret?: string;
  run: (conversationId: string) => Promise<Outcome>;
  sleep: (ms: number) => Promise<void>;
  /** Espera antes de processar, para juntar várias mensagens seguidas do cliente numa resposta só. */
  debounceMs: number;
}

const bodySchema = z.object({ conversation_id: z.string().uuid() });

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * POST /api/sdr/process — roda a IA numa conversa. NUNCA é chamado direto pelo navegador:
 * o webhook só avisa (em segundo plano) depois de gravar a mensagem; este endereço é uma
 * execução separada, protegida por um segredo interno.
 */
export async function handleProcess(request: Request, deps: ProcessDeps): Promise<Response> {
  if (!deps.secret) return json({ error: "nao_configurado" }, 500);
  const sent = request.headers.get("x-internal-secret") ?? "";
  if (!sent || !safeEqualText(sent, deps.secret)) return json({ error: "nao_autorizado" }, 401);

  let conversationId: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "dados_invalidos" }, 400);
    conversationId = parsed.data.conversation_id;
  } catch {
    return json({ error: "dados_invalidos" }, 400);
  }

  await deps.sleep(deps.debounceMs);
  const outcome = await deps.run(conversationId);
  // Só o resultado (nunca texto de conversa), para acompanhar o que a IA fez.
  console.log(`[sdr] resultado=${outcome}`);
  return json({ ok: true, outcome }, 200);
}
