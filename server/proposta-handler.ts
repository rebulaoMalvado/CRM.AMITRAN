import { z } from "zod";
import { COMPANY } from "./company.js";
import type { PropostaForm } from "../src/lib/proposta.js";
import { classifyUpload } from "./media-upload.js";
import { deliverFile, isWindowOpen, WINDOW_CLOSED_RESPONSE, type SendMediaDeps } from "./send-media-handler.js";
import type { AuthUser, ConversationRow } from "./send-handler.js";

/** O PDF é gerado no servidor e enviado direto ao WhatsApp, então não passa pelo limite de 4 MB da Vercel. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;

export interface PropostaStore {
  getDealAccess(dealId: string): Promise<{ id: string; seller_id: string; stage: string; nome: string } | null>;
  /** Conversa de WhatsApp ligada ao negócio (null = o lead não veio pelo WhatsApp). */
  getConversationByDeal(dealId: string): Promise<ConversationRow | null>;
  /** Passa o negócio para "Orçamento enviado" (só se ainda estiver em Lead Novo ou Qualificação). */
  markProposalSent(dealId: string): Promise<void>;
}

export interface PropostaDeps extends SendMediaDeps {
  proposta: PropostaStore;
  renderPdf: (form: PropostaForm) => Promise<Uint8Array>;
  /**
   * Foto (JPEG) da capa da proposta. Opcional: com ela, o cliente recebe primeiro a imagem da capa
   * (que aparece na hora no WhatsApp) e depois o PDF. Sem ela, ou se falhar, vai só o PDF.
   */
  renderCover?: (form: PropostaForm) => Promise<Uint8Array | null>;
}

const str = (max: number) => z.string().max(max);
const formSchema = z.object({
  nomeCliente: str(200),
  telefoneCliente: str(60),
  volumeEstimado: str(40),
  dataMudanca: str(20),
  prazoExecucao: str(120),
  tipo: str(60),
  origem: str(300),
  destino: str(300),
  observacoes: str(2000),
  valorMudanca: z.number().finite().min(0).max(1_000_000_000),
  valorSeguro: str(80),
  total: str(200),
  nomeVendedor: str(120),
  emailVendedor: str(120),
});

const sendSchema = z.object({
  deal_id: z.string().uuid(),
  form: formSchema,
  caption: str(1000).optional(),
  mark_sent: z.boolean().optional(),
});
const pdfSchema = z.object({ deal_id: z.string().uuid(), form: formSchema });

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().replace(/\s+/g, " ") || "cliente";
export const proposalFilename = (clientName: string) => `${COMPANY.proposalFilePrefix} - ${safeName(clientName)}.pdf`;

/** Mensagem que acompanha o PDF (o vendedor pode trocar o texto antes de enviar). */
export function defaultCaption(form: PropostaForm): string {
  const first = safeName(form.nomeCliente).split(" ")[0] || "";
  const trip = form.origem && form.destino ? ` para a sua mudança de ${form.origem} para ${form.destino}` : " para a sua mudança";
  return `Olá${first && first !== "cliente" ? `, ${first}` : ""}! Segue a proposta da ${COMPANY.name}${trip}. Qualquer dúvida é só me chamar!`.slice(0, 1000);
}

/** Confere o login ANTES de olhar o corpo da requisição. */
async function authenticate(request: Request, deps: PropostaDeps): Promise<{ user?: AuthUser; error?: Response }> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return { error: json({ error: "nao_autenticado", message: "Faça login." }, 401) };
  const user = await deps.authenticate(jwt);
  if (!user) return { error: json({ error: "nao_autenticado", message: "Sessão inválida ou expirada." }, 401) };
  return { user };
}

async function authorizeDeal(user: AuthUser, deps: PropostaDeps, dealId: string) {
  const deal = await deps.proposta.getDealAccess(dealId);
  // Sem permissão responde igual a "não existe".
  if (!deal || (user.role !== "head" && deal.seller_id !== user.id)) {
    return { error: json({ error: "negocio_nao_encontrado", message: "Negócio não encontrado." }, 404) };
  }
  return { deal };
}

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<{ data?: T; error?: Response }> {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return { error: json({ error: "dados_invalidos", message: "Dados da proposta inválidos." }, 400) };
    return { data: parsed.data };
  } catch {
    return { error: json({ error: "dados_invalidos", message: "Corpo da requisição inválido." }, 400) };
  }
}

/** POST /api/proposta/pdf — gera o PDF no servidor e devolve para baixar. */
export async function handlePropostaPdf(request: Request, deps: PropostaDeps): Promise<Response> {
  const login = await authenticate(request, deps);
  if (login.error || !login.user) return login.error as Response;
  const body = await readJson(request, pdfSchema);
  if (body.error || !body.data) return body.error as Response;
  const access = await authorizeDeal(login.user, deps, body.data.deal_id);
  if (access.error) return access.error;

  const pdfForm = body.data.form as PropostaForm;
  let pdf: Uint8Array;
  try {
    pdf = await deps.renderPdf(pdfForm);
  } catch (err) {
    console.error("[proposta/pdf] falha ao gerar:", err instanceof Error ? err.message : err);
    return json({ error: "pdf_falhou", message: "Não consegui gerar o PDF agora. Tente de novo em instantes." }, 502);
  }

  // Resposta em pedaços (streaming): a Vercel limita respostas "de uma vez" a ~4,5 MB.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const CHUNK = 256 * 1024;
      for (let i = 0; i < pdf.length; i += CHUNK) controller.enqueue(pdf.subarray(i, i + CHUNK));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(proposalFilename(pdfForm.nomeCliente))}`,
      "cache-control": "private, no-store",
    },
  });
}

/**
 * POST /api/proposta/enviar — gera o PDF e envia ao cliente pela conversa de WhatsApp do lead.
 * Regras: login; vendedor só nos negócios dele; o negócio precisa ter conversa; janela de 24h aberta.
 */
export async function handlePropostaSend(request: Request, deps: PropostaDeps): Promise<Response> {
  const login = await authenticate(request, deps);
  if (login.error || !login.user) return login.error as Response;
  const user = login.user;
  const body = await readJson(request, sendSchema);
  if (body.error || !body.data) return body.error as Response;
  const { deal_id, caption, mark_sent } = body.data;
  // (conversão explícita: com a validação do zod no modo menos rígido da Vercel, os campos pareceriam opcionais)
  const form = body.data.form as PropostaForm;

  const access = await authorizeDeal(user, deps, deal_id);
  if (access.error) return access.error;

  const conversation = await deps.proposta.getConversationByDeal(deal_id);
  if (!conversation) {
    return json({ error: "sem_conversa", message: "Este lead não tem conversa de WhatsApp. Baixe o PDF e envie por outro canal." }, 409);
  }
  if (user.role !== "head" && conversation.assigned_seller_id !== user.id) {
    return json({ error: "conversa_nao_encontrada", message: "Conversa não encontrada." }, 404);
  }
  // Confere a janela ANTES de gastar tempo gerando o PDF.
  if (!isWindowOpen(conversation, (deps.now ?? Date.now)())) return WINDOW_CLOSED_RESPONSE();

  let pdf: Uint8Array;
  try {
    pdf = await deps.renderPdf(form);
  } catch (err) {
    console.error("[proposta/enviar] falha ao gerar:", err instanceof Error ? err.message : err);
    return json({ error: "pdf_falhou", message: "Não consegui gerar o PDF agora. Tente de novo em instantes." }, 502);
  }

  const kind = classifyUpload("application/pdf", pdf.byteLength, MAX_PDF_BYTES);
  if (!kind.ok || !kind.kind) return json({ error: "arquivo_invalido", message: kind.message ?? "PDF inválido." }, kind.status ?? 400);

  const finalCaption = (caption?.trim() || defaultCaption(form)).slice(0, 1000);

  // 1) Capa como imagem (com a legenda). Qualquer falha aqui é ignorada: o PDF vai do mesmo jeito.
  let pdfCaption: string | null = finalCaption;
  if (deps.renderCover) {
    try {
      const cover = await deps.renderCover(form);
      const coverKind = cover ? classifyUpload("image/jpeg", cover.byteLength) : null;
      if (cover && coverKind?.ok && coverKind.kind) {
        const coverRes = await deliverFile(deps, {
          user,
          conversation,
          kind: coverKind.kind,
          bytes: toArrayBuffer(cover),
          mime: "image/jpeg",
          filename: `${COMPANY.proposalFilePrefix} - capa.jpg`,
          caption: finalCaption,
        });
        if (coverRes.status === 200) pdfCaption = null; // a legenda já foi junto com a capa
        else console.error("[proposta/enviar] capa não enviada; seguindo só com o PDF");
      }
    } catch (err) {
      console.error("[proposta/enviar] falha na capa; seguindo só com o PDF:", err instanceof Error ? err.message : err);
    }
  }

  // 2) O PDF completo.
  const res = await deliverFile(deps, {
    user,
    conversation,
    kind: kind.kind,
    bytes: toArrayBuffer(pdf),
    mime: "application/pdf",
    filename: proposalFilename(form.nomeCliente),
    caption: pdfCaption,
  });

  if (res.status === 200 && mark_sent) await deps.proposta.markProposalSent(deal_id);
  return res;
}
