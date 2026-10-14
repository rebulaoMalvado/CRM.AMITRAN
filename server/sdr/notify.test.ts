import { describe, expect, it, vi } from "vitest";
import { buildText, notifySeller, notifySellerDetailed, oneLine, parseSellerPhones, type NotifyDeps, type LeadNotice } from "./notify.js";

const NOW = Date.parse("2026-10-02T15:00:00Z");
const lead: LeadNotice = { conversationId: "conv-1", nome: "Maria Souza", origem: "Santa Maria, BH", destino: "Contagem", dataLabel: "dia 15 de novembro" };

function makeDeps(opts: {
  lastInboundAt?: string | null;
  conv?: boolean;
  templateName?: string;
  textOk?: boolean;
  templateOk?: boolean;
  phones?: Record<string, string>;
} = {}) {
  const sendText = vi.fn(async () => (opts.textOk === false ? { ok: false, error: "131047" } : { ok: true, wamid: "w1" }));
  const sendTemplate = vi.fn(async () => (opts.templateOk === false ? { ok: false, error: "132001" } : { ok: true, wamid: "w2" }));
  const deps: NotifyDeps = {
    phones: opts.phones ?? { "u-raufle": "5531988880003" },
    crmUrl: "https://crm.amitran.test",
    templateName: opts.templateName,
    findSellerConversation: async () =>
      opts.conv === false ? null : { waId: "553188880003", telefoneNorm: "5531988880003", lastInboundAt: opts.lastInboundAt === undefined ? "2026-10-02T10:00:00Z" : opts.lastInboundAt },
    sendText,
    sendTemplate,
    now: () => NOW,
  };
  return { deps, sendText, sendTemplate };
}

describe("notifySeller", () => {
  it("janela de 24h aberta: manda texto normal para o wa_id do vendedor, com link da conversa", async () => {
    const t = makeDeps();
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("sent_text");
    expect(t.sendText).toHaveBeenCalledTimes(1);
    const [to, body] = t.sendText.mock.calls[0] as unknown as [string, string];
    expect(to).toBe("553188880003"); // wa_id como a Meta conhece (sem o 9º dígito)
    expect(body).toContain("Maria Souza");
    expect(body).toContain("Santa Maria, BH");
    expect(body).toContain("Contagem");
    expect(body).toContain("https://crm.amitran.test/conversas?conversa=conv-1");
    expect(t.sendTemplate).not.toHaveBeenCalled();
  });

  it("janela fechada e com modelo configurado: manda o modelo com 4 parâmetros", async () => {
    const t = makeDeps({ lastInboundAt: "2026-10-01T10:00:00Z", templateName: "novo_lead_qualificado" });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("sent_template");
    expect(t.sendText).not.toHaveBeenCalled();
    expect(t.sendTemplate).toHaveBeenCalledWith("553188880003", "novo_lead_qualificado", "pt_BR", ["Maria Souza", "Santa Maria, BH", "Contagem", "dia 15 de novembro"]);
  });

  it("janela fechada e SEM modelo: não manda nada e diz o motivo", async () => {
    const t = makeDeps({ lastInboundAt: "2026-10-01T10:00:00Z" });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("window_closed_no_template");
    expect(t.sendText).not.toHaveBeenCalled();
    expect(t.sendTemplate).not.toHaveBeenCalled();
  });

  it("vendedor que nunca escreveu para a Amitran: usa o modelo (ou avisa que falta)", async () => {
    const withTemplate = makeDeps({ conv: false, templateName: "novo_lead_qualificado" });
    expect(await notifySeller(withTemplate.deps, "u-raufle", lead)).toBe("sent_template");
    expect((withTemplate.sendTemplate.mock.calls[0] as unknown as string[])[0]).toBe("5531988880003");
    const without = makeDeps({ conv: false });
    expect(await notifySeller(without.deps, "u-raufle", lead)).toBe("window_closed_no_template");
  });

  it("texto recusado pela Meta (janela já fechada lá): tenta o modelo", async () => {
    const t = makeDeps({ textOk: false, templateName: "novo_lead_qualificado" });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("sent_template");
  });

  it("texto recusado e sem modelo: falha (sem lançar erro)", async () => {
    const t = makeDeps({ textOk: false });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("failed");
  });

  it("modelo recusado: falha (sem lançar erro)", async () => {
    const t = makeDeps({ lastInboundAt: null, templateName: "x", templateOk: false });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("failed");
  });

  it("vendedor sem telefone cadastrado: não manda nada", async () => {
    const t = makeDeps({ phones: {} });
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("no_phone");
    expect(t.sendText).not.toHaveBeenCalled();
  });

  it("qualquer exceção vira 'failed' e nunca estoura", async () => {
    const t = makeDeps();
    t.deps.findSellerConversation = async () => {
      throw new Error("banco fora");
    };
    expect(await notifySeller(t.deps, "u-raufle", lead)).toBe("failed");
  });
});

describe("helpers do aviso", () => {
  it("oneLine tira quebras de linha e espaços repetidos (a Meta recusa nos modelos) e nunca fica vazio", () => {
    expect(oneLine("Rua A,\n  nº 10\t\tCentro")).toBe("Rua A, nº 10 Centro");
    expect(oneLine("   ")).toBe("não informado");
    expect(oneLine("x".repeat(500)).length).toBe(120);
  });

  it("parseSellerPhones aceita formatos variados e ignora lixo", () => {
    expect(parseSellerPhones("a=31 98888-0003, b=(31) 98888-0004,lixo,c=")).toEqual({ a: "5531988880003", b: "5531988880004" });
    expect(parseSellerPhones(undefined)).toEqual({});
  });

  it("buildText não traz preço nem dados além dos necessários", () => {
    const text = buildText(lead, "https://x.app");
    expect(text).not.toMatch(/R\$/);
    expect(text.split("\n").length).toBeLessThan(14);
    expect(text).toContain("prontinho pro fechamento");
  });
});

describe("notifySellerDetailed", () => {
  it("devolve o motivo da Meta quando o modelo é recusado", async () => {
    const t = makeDeps({ lastInboundAt: null, templateName: "novo_lead_qualificado" });
    t.sendTemplate.mockResolvedValueOnce({ ok: false, error: "Meta recusou o envio (HTTP 400): 131042 · pagamento" });
    expect(await notifySellerDetailed(t.deps, "u-raufle", lead)).toEqual({ outcome: "failed", error: "Meta recusou o envio (HTTP 400): 131042 · pagamento" });
  });
  it("sucesso não traz erro", async () => {
    const t = makeDeps();
    expect(await notifySellerDetailed(t.deps, "u-raufle", lead)).toEqual({ outcome: "sent_text" });
  });
});
