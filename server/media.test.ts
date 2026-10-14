import { describe, expect, it, vi } from "vitest";
import { handleMedia, type MediaDeps } from "./media-handler.js";
import { fetchWhatsappMedia } from "./whatsapp-media.js";
import type { AuthUser } from "./send-handler.js";

const HEAD: AuthUser = { id: "u-head", role: "head" };
const SELLER: AuthUser = { id: "u-seller", role: "vendedor" };
const OTHER: AuthUser = { id: "u-other", role: "vendedor" };
const MSG = "11111111-1111-4111-8111-111111111111";
const config = { accessToken: "dh_live_segredo", apiBaseUrl: "https://api.dualhook.com", apiVersion: "v25.0" };

const bytes = (type = "image/jpeg") =>
  ({ ok: true, status: 200, body: new Response("conteudo-da-foto").body, contentType: type, contentLength: "16" }) as const;

function setup(opts: {
  user?: AuthUser | null;
  message?: { conversation_id: string; type: string; payload: Record<string, any> | null } | null;
  assigned?: string | null;
  media?: Awaited<ReturnType<NonNullable<MediaDeps["fetchMedia"]>>>;
} = {}) {
  const fetchMedia = vi.fn(async () => opts.media ?? bytes());
  const message = opts.message === undefined ? { conversation_id: "c1", type: "image", payload: { image: { id: "1234567890", mime_type: "image/jpeg" } } } : opts.message;
  const deps: MediaDeps = {
    config,
    authenticate: async (jwt) => (jwt === "ok" ? (opts.user === undefined ? SELLER : opts.user) : null),
    store: {
      getMessage: async () => message,
      getConversationAccess: async () => ({ assigned_seller_id: opts.assigned === undefined ? SELLER.id : opts.assigned }),
    },
    fetchMedia,
  };
  return { deps, fetchMedia };
}
const req = (message: string | null = MSG, auth: string | null = "Bearer ok") =>
  new Request(`https://x/api/whatsapp/media${message ? `?message=${message}` : ""}`, { headers: auth ? { authorization: auth } : {} });

describe("handleMedia — permissões", () => {
  it("vendedor responsável e Head recebem a mídia; o token nunca é exposto", async () => {
    for (const user of [SELLER, HEAD]) {
      const t = setup({ user });
      const res = await handleMedia(req(), t.deps);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("conteudo-da-foto");
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(JSON.stringify([...res.headers])).not.toContain("dh_live");
    }
    expect(setup().fetchMedia).not.toHaveBeenCalled();
  });

  it("outro vendedor, conversa sem dono (vendedor) ou mensagem inexistente => 404 e nada é baixado", async () => {
    const other = setup({ user: OTHER });
    expect((await handleMedia(req(), other.deps)).status).toBe(404);
    const unassigned = setup({ assigned: null });
    expect((await handleMedia(req(), unassigned.deps)).status).toBe(404);
    const missing = setup({ message: null });
    expect((await handleMedia(req(), missing.deps)).status).toBe(404);
    for (const t of [other, unassigned, missing]) expect(t.fetchMedia).not.toHaveBeenCalled();
  });

  it("Head vê mídia de conversa sem dono", async () => {
    expect((await handleMedia(req(), setup({ user: HEAD, assigned: null }).deps)).status).toBe(200);
  });

  it("sem login ou login inválido => 401; id inválido => 400", async () => {
    const t = setup();
    expect((await handleMedia(req(MSG, null), t.deps)).status).toBe(401);
    expect((await handleMedia(req(MSG, "Bearer falso"), t.deps)).status).toBe(401);
    expect((await handleMedia(req("nao-e-uuid"), t.deps)).status).toBe(400);
    expect((await handleMedia(req(null), t.deps)).status).toBe(400);
    expect(t.fetchMedia).not.toHaveBeenCalled();
  });
});

describe("handleMedia — conteúdo", () => {
  it("o ID da mídia vem do banco (payload da mensagem), nunca do navegador", async () => {
    const t = setup();
    await handleMedia(req(), t.deps);
    expect(t.fetchMedia).toHaveBeenCalledWith(config, "1234567890");
  });

  it("mensagem de texto ou sem ID de mídia => 404", async () => {
    expect((await handleMedia(req(), setup({ message: { conversation_id: "c1", type: "text", payload: { text: { body: "oi" } } } }).deps)).status).toBe(404);
    expect((await handleMedia(req(), setup({ message: { conversation_id: "c1", type: "image", payload: {} } }).deps)).status).toBe(404);
    expect((await handleMedia(req(), setup({ message: { conversation_id: "c1", type: "image", payload: null } }).deps)).status).toBe(404);
  });

  it("tipo perigoso (HTML/SVG) vira download genérico, nunca é exibido", async () => {
    for (const dangerous of ["text/html", "image/svg+xml", "application/javascript"]) {
      const t = setup({
        message: { conversation_id: "c1", type: "document", payload: { document: { id: "999", mime_type: dangerous } } },
        media: bytes(dangerous),
      });
      const res = await handleMedia(req(), t.deps);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toBe("attachment");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("tipos seguros (foto, vídeo, áudio, PDF) são exibidos inline", async () => {
    for (const type of ["image/png", "video/mp4", "audio/ogg; codecs=opus", "application/pdf"]) {
      const t = setup({ media: bytes(type), message: { conversation_id: "c1", type: "document", payload: { document: { id: "999", mime_type: type } } } });
      const res = await handleMedia(req(), t.deps);
      expect(res.headers.get("content-disposition")).toBe("inline");
    }
  });

  it("mídia expirada (14 dias) => 410; falha de rede => 502", async () => {
    const gone = await handleMedia(req(), setup({ media: { ok: false, status: 404, error: "x" } }).deps);
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { error: string }).error).toBe("midia_expirada");
    expect((await handleMedia(req(), setup({ media: { ok: false, error: "rede" } }).deps)).status).toBe(502);
  });
});

describe("fetchWhatsappMedia", () => {
  it("Dualhook: GET /{versão}/{id}/content com a chave", async () => {
    const f = vi.fn(async () => new Response("bytes", { status: 200, headers: { "content-type": "image/jpeg" } }));
    const r = await fetchWhatsappMedia(config, "1234567890", f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.dualhook.com/v25.0/1234567890/content");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dh_live_segredo");
  });

  it("Meta direto: busca a URL e depois baixa com o token", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/foto" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("bytes", { status: 200, headers: { "content-type": "image/png" } }));
    const r = await fetchWhatsappMedia({ accessToken: "TOKEN", apiVersion: "v25.0" }, "abc123", f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://graph.facebook.com/v25.0/abc123");
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe("https://lookaside.fbsbx.com/foto");
  });

  it("recusa ID estranho, endereço sem https e sem token; erros viram {ok:false}", async () => {
    const f = vi.fn();
    expect((await fetchWhatsappMedia(config, "../../etc/passwd", f as unknown as typeof fetch)).ok).toBe(false);
    expect((await fetchWhatsappMedia(config, "123?x=1", f as unknown as typeof fetch)).ok).toBe(false);
    expect((await fetchWhatsappMedia({ ...config, apiBaseUrl: "http://inseguro.com" }, "123456", f as unknown as typeof fetch)).ok).toBe(false);
    expect((await fetchWhatsappMedia({}, "123456", f as unknown as typeof fetch)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect((await fetchWhatsappMedia(config, "123456", boom as unknown as typeof fetch)).ok).toBe(false);
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    const r = await fetchWhatsappMedia(config, "123456", notFound as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});
