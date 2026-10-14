import { describe, expect, it, vi } from "vitest";
import { classifyUpload, MAX_UPLOAD_BYTES, sendWhatsappMedia, uploadWhatsappMedia } from "./media-upload.js";
import { handleSendMedia, type SendMediaDeps } from "./send-media-handler.js";
import type { AuthUser, ConversationRow, SendStore } from "./send-handler.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const OTHER: AuthUser = { id: "u-other", role: "vendedor" };
const CONV = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const config = { accessToken: "dh_live_segredo", phoneNumberId: "997", apiBaseUrl: "https://api.dualhook.com", apiVersion: "v25.0" };

describe("classifyUpload", () => {
  it("classifica foto, vídeo, áudio e documento", () => {
    expect(classifyUpload("image/jpeg", 1000)).toMatchObject({ ok: true, kind: "image" });
    expect(classifyUpload("image/png", 1000)).toMatchObject({ ok: true, kind: "image" });
    expect(classifyUpload("video/mp4", 1000)).toMatchObject({ ok: true, kind: "video" });
    expect(classifyUpload("audio/ogg; codecs=opus", 1000)).toMatchObject({ ok: true, kind: "audio" });
    expect(classifyUpload("application/pdf", 1000)).toMatchObject({ ok: true, kind: "document" });
    expect(classifyUpload("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1000)).toMatchObject({ ok: true, kind: "document" });
  });

  it("recusa tipos perigosos ou desconhecidos (415), vazio (400) e grande demais (413)", () => {
    for (const bad of ["text/html", "image/svg+xml", "application/x-msdownload", "application/zip", "", "image/webp"]) {
      expect(classifyUpload(bad, 1000)).toMatchObject({ ok: false, status: 415 });
    }
    expect(classifyUpload("image/jpeg", 0)).toMatchObject({ ok: false, status: 400 });
    expect(classifyUpload("application/pdf", MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, status: 413 });
    expect(classifyUpload("application/pdf", MAX_UPLOAD_BYTES)).toMatchObject({ ok: true });
  });
});

describe("uploadWhatsappMedia / sendWhatsappMedia", () => {
  it("sobe o arquivo (multipart) e devolve o ID da mídia, usando o endereço do Dualhook", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "MEDIA1" }), { status: 200 }));
    const r = await uploadWhatsappMedia(config, { bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/jpeg", filename: "foto.jpg" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, mediaId: "MEDIA1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.dualhook.com/v25.0/997/media");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dh_live_segredo");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("messaging_product")).toBe("whatsapp");
  });

  it("monta a mensagem certa para foto (com legenda), documento (com nome) e áudio (sem legenda)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.M" }] }), { status: 200 }));
    const body = (i: number) => JSON.parse(((f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string));

    await sendWhatsappMedia(config, { to: "5531", kind: "image", mediaId: "M1", caption: "sua sala" }, f as unknown as typeof fetch);
    expect(body(0)).toMatchObject({ type: "image", image: { id: "M1", caption: "sua sala" } });

    await sendWhatsappMedia(config, { to: "5531", kind: "document", mediaId: "M2", caption: "proposta", filename: "proposta.pdf" }, f as unknown as typeof fetch);
    expect(body(1)).toMatchObject({ type: "document", document: { id: "M2", caption: "proposta", filename: "proposta.pdf" } });

    await sendWhatsappMedia(config, { to: "5531", kind: "audio", mediaId: "M3", caption: "ignorada" }, f as unknown as typeof fetch);
    expect(body(2).audio).toEqual({ id: "M3" });
  });

  it("erros viram {ok:false} sem vazar o token; sem configuração não chama a rede", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "Invalid dh_live_segredo" } }), { status: 401 }));
    const r = await sendWhatsappMedia(config, { to: "5531", kind: "image", mediaId: "M1" }, bad as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("dh_live_segredo");
    const none = vi.fn();
    expect((await uploadWhatsappMedia({}, { bytes: new ArrayBuffer(1), mime: "image/jpeg", filename: "a.jpg" }, none as unknown as typeof fetch)).ok).toBe(false);
    expect(none).not.toHaveBeenCalled();
  });
});

function setup(opts: { user?: AuthUser | null; conversation?: Partial<ConversationRow> | null; upload?: SendMediaDeps["upload"]; sendMedia?: SendMediaDeps["sendMedia"] } = {}) {
  const conv: ConversationRow | null =
    opts.conversation === null ? null : { id: CONV, wa_id: "553188880001", assigned_seller_id: SELLER.id, last_inbound_at: hoursAgo(1), ...opts.conversation };
  const inserted: Parameters<SendStore["insertOutboundMessage"]>[0][] = [];
  const humanReplied: string[] = [];
  const upload = opts.upload ?? vi.fn(async () => ({ ok: true, mediaId: "MEDIA1" }));
  const sendMedia = opts.sendMedia ?? vi.fn(async () => ({ ok: true, wamid: "wamid.NOVO" }));
  const user = opts.user === undefined ? SELLER : opts.user;
  const deps: SendMediaDeps = {
    config,
    authenticate: async (jwt) => (jwt === "ok" ? user : null),
    store: { getConversation: async () => conv, insertOutboundMessage: async (m) => void inserted.push(m), markHumanReplied: async (id) => void humanReplied.push(id) },
    upload,
    sendMedia,
    now: () => NOW,
  };
  return { deps, inserted, humanReplied, upload, sendMedia };
}

function req(fields: { conversation_id?: string; caption?: string; file?: File | null } = {}, auth: string | null = "Bearer ok") {
  const form = new FormData();
  form.set("conversation_id", fields.conversation_id ?? CONV);
  if (fields.caption !== undefined) form.set("caption", fields.caption);
  if (fields.file !== null) form.set("file", fields.file ?? new File([new Uint8Array(2000)], "sala.jpg", { type: "image/jpeg" }));
  return new Request("https://x/api/whatsapp/send-media", { method: "POST", headers: auth ? { authorization: auth } : {}, body: form });
}

describe("handleSendMedia", () => {
  it("envia a foto com legenda, grava com o ID da mídia e passa a conversa para humano", async () => {
    const t = setup();
    const res = await handleSendMedia(req({ caption: "  veja a sala  " }), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, type: "image" });
    expect(t.sendMedia).toHaveBeenCalledWith(config, { to: "553188880001", kind: "image", mediaId: "MEDIA1", caption: "veja a sala", filename: "sala.jpg" });
    expect(t.inserted[0]).toMatchObject({
      type: "image", content: "veja a sala", whatsappMessageId: "wamid.NOVO", status: "sent",
      payload: { image: { id: "MEDIA1", mime_type: "image/jpeg", filename: "sala.jpg" } },
    });
    expect(t.humanReplied).toEqual([CONV]);
  });

  it("PDF vira documento; Head envia em qualquer conversa", async () => {
    const t = setup({ user: HEAD, conversation: { assigned_seller_id: null } });
    const pdf = new File([new Uint8Array(3000)], "proposta amitran.pdf", { type: "application/pdf" });
    expect((await handleSendMedia(req({ file: pdf }), t.deps)).status).toBe(200);
    expect(t.inserted[0]).toMatchObject({ type: "document", content: null });
  });

  it("outro vendedor => 404; sem login => 401; arquivo ausente ou id ruim => 400; nada é enviado", async () => {
    const other = setup({ user: OTHER });
    expect((await handleSendMedia(req(), other.deps)).status).toBe(404);
    const t = setup();
    expect((await handleSendMedia(req({}, null), t.deps)).status).toBe(401);
    expect((await handleSendMedia(req({ file: null }), t.deps)).status).toBe(400);
    expect((await handleSendMedia(req({ conversation_id: "x" }), t.deps)).status).toBe(400);
    for (const s of [other, t]) {
      expect(s.upload).not.toHaveBeenCalled();
      expect(s.sendMedia).not.toHaveBeenCalled();
    }
  });

  it("tipo perigoso => 415 e tamanho acima do limite => 413, sem enviar", async () => {
    const t = setup();
    const html = new File(["<script>alert(1)</script>"], "x.html", { type: "text/html" });
    expect((await handleSendMedia(req({ file: html }), t.deps)).status).toBe(415);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 10)], "grande.pdf", { type: "application/pdf" });
    expect((await handleSendMedia(req({ file: big }), t.deps)).status).toBe(413);
    expect(t.upload).not.toHaveBeenCalled();
  });

  it("janela de 24h fechada => 409 e nada é enviado", async () => {
    const t = setup({ conversation: { last_inbound_at: hoursAgo(25) } });
    const res = await handleSendMedia(req(), t.deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("janela_24h_fechada");
    expect(t.upload).not.toHaveBeenCalled();
  });

  it("falha no upload ou no envio => 502 e a tentativa fica registrada como 'failed' (sem passar para humano)", async () => {
    const up = setup({ upload: async () => ({ ok: false, error: "WhatsApp recusou (HTTP 400): arquivo inválido" }) });
    expect((await handleSendMedia(req(), up.deps)).status).toBe(502);
    expect(up.inserted[0]).toMatchObject({ status: "failed", type: "image", whatsappMessageId: null });
    expect(up.humanReplied).toHaveLength(0);

    const send = setup({ sendMedia: async () => ({ ok: false, error: "131047 · fora da janela" }) });
    expect((await handleSendMedia(req(), send.deps)).status).toBe(502);
    expect(send.inserted[0]).toMatchObject({ status: "failed", error: expect.stringContaining("131047") });
  });
});
