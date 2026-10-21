import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatIsoDateBr, isBusinessHoursBrt, mentionsPrice, sanitizeOutput, startOfDayBrt } from "./guards.js";
import { PRICE_FALLBACK_REPLY, countMedia, isAutoAllowed, processConversation, usedNameRecently, toLlmMessages, type HistoryMessage, type SdrConversation, type SdrDeps, type SdrStore } from "./engine.js";
import { LlmError, type LlmProvider } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";

const CONV = "11111111-1111-4111-8111-111111111111";

describe("mentionsPrice (a IA nunca fala de dinheiro)", () => {
  it.each([
    "O valor fica em R$ 1.200",
    "Isso custa pouco",
    "o preço depende",
    "Dá uns 2 mil reais",
    "aceitamos pix e cartão",
    "parcelamos em 10x",
    "tem desconto para pagamento à vista",
    "é bem barato",
    "fica uns 3k",
    "Valores a combinar",
  ])("bloqueia: %s", (text) => {
    expect(mentionsPrice(text)).not.toBeNull();
  });

  it.each([
    "Oi! Sou o assistente da Amitran. De onde para onde será a mudança?",
    "Perfeito, Maria! Um consultor vai te enviar o orçamento certinho.",
    "E aí cara, tudo bem? Qual a data que você pensou?",
    "Tem escada ou elevador no prédio da entrada?",
    "Anotei: apartamento de 2 quartos, 3º andar sem elevador.",
  ])("deixa passar: %s", (text) => {
    expect(mentionsPrice(text)).toBeNull();
  });

  it("pega variações com acento e maiúsculas", () => {
    expect(mentionsPrice("PREÇO")).not.toBeNull();
    expect(mentionsPrice("preco")).not.toBeNull();
    expect(mentionsPrice("r$500")).not.toBeNull();
  });
});

describe("sanitizeOutput (a IA só escreve campos permitidos)", () => {
  const base = {
    reply: "Oi!",
    handoff: false,
    handoff_reason: null,
    qualification: {
      nome: "Maria", origem: null, destino: null, data_mudanca: null, data_iso: null, bens: null,
    },
  };

  it("mantém só valores preenchidos e descarta chaves desconhecidas", () => {
    const out = sanitizeOutput({
      ...base,
      qualification: { ...base.qualification, origem: "  BH  ", valor_orcamento: "5000", seller_id: "x", tipo_servico: "completo" },
    });
    expect(out?.qualification).toEqual({ nome: "Maria", origem: "BH" });
  });

  it("limita tamanhos", () => {
    const out = sanitizeOutput({ ...base, reply: "a".repeat(5000), qualification: { ...base.qualification, nome: "x".repeat(500) } });
    expect(out?.reply?.length).toBe(900);
    expect(out?.qualification.nome?.length).toBe(80);
  });

  it("recusa saída fora do formato", () => {
    expect(sanitizeOutput(null)).toBeNull();
    expect(sanitizeOutput({ reply: 1 })).toBeNull();
    expect(sanitizeOutput({ ...base, qualification: { ...base.qualification, bens: 123 } })).toBeNull();
  });

  it("resposta vazia vira null", () => {
    expect(sanitizeOutput({ ...base, reply: "   " })?.reply).toBeNull();
  });

  describe("data em formato de calendário", () => {
    const withDate = (data_mudanca: string | null, data_iso: string | null) => ({ ...base, qualification: { ...base.qualification, data_mudanca, data_iso } });

    it("com data real, 'terça que vem' vira 20/10/2026 (e o data_iso fica guardado)", () => {
      const out = sanitizeOutput(withDate("terça que vem", "2026-10-20"), "2026-10-14");
      expect(out?.qualification.data_mudanca).toBe("20/10/2026");
      expect(out?.qualification.data_iso).toBe("2026-10-20");
    });

    it("mesmo sem o texto do cliente, a data de calendário aparece", () => {
      expect(sanitizeOutput(withDate(null, "2026-12-05"), "2026-10-14")?.qualification.data_mudanca).toBe("05/12/2026");
    });

    it("data vaga (sem data_iso) mantém o que o cliente disse", () => {
      expect(sanitizeOutput(withDate("no fim do mês", null), "2026-10-14")?.qualification.data_mudanca).toBe("no fim do mês");
    });

    it("data impossível ou passada é descartada e o texto do cliente é mantido", () => {
      for (const bad of ["2020-01-01", "2026-02-31", "amanhã", "2026-10-13"]) {
        const out = sanitizeOutput(withDate("terça que vem", bad), "2026-10-14");
        expect(out?.qualification.data_mudanca).toBe("terça que vem");
        expect(out?.qualification.data_iso).toBeUndefined();
      }
    });

    it("formatIsoDateBr", () => {
      expect(formatIsoDateBr("2026-10-20")).toBe("20/10/2026");
    });
  });
});

describe("startOfDayBrt", () => {
  it("usa o dia de Brasília (UTC-3)", () => {
    expect(startOfDayBrt(Date.parse("2026-10-01T15:00:00Z"))).toBe("2026-10-01T03:00:00.000Z");
    expect(startOfDayBrt(Date.parse("2026-10-01T02:00:00Z"))).toBe("2026-09-30T03:00:00.000Z");
  });
});

describe("toLlmMessages", () => {
  const m = (direction: "inbound" | "outbound", sender: HistoryMessage["sender"], content: string | null, status = "received", type = "text"): HistoryMessage => ({
    direction, sender, content, status, type,
  });

  it("junta mensagens seguidas, ignora rascunho/falha/sistema e começa pelo cliente", () => {
    const out = toLlmMessages([
      m("outbound", "human", "Oi, aqui é a Amitran", "sent"),
      m("inbound", "contact", "Oi"),
      m("inbound", "contact", "preciso de mudança"),
      m("outbound", "ai", "rascunho que ninguém viu", "draft"),
      m("outbound", "ai", "falhou", "failed"),
      m("outbound", "human", "Claro! De onde sai?", "sent"),
      m("inbound", "contact", null, "received", "audio"),
    ]);
    expect(out).toEqual([
      { role: "user", content: "Oi\npreciso de mudança" },
      { role: "assistant", content: "Claro! De onde sai?" },
      { role: "user", content: "[o cliente enviou um áudio]" },
    ]);
  });
});

describe("mensagens longas do cliente", () => {
  const long = (n: number): HistoryMessage => ({ direction: "inbound", sender: "contact", type: "text", content: "a".repeat(n), status: "received" });

  it("uma mensagem longa de WhatsApp (2.400 caracteres) chega INTEIRA para a IA", () => {
    const out = toLlmMessages([long(2404)]);
    expect(out[0].content.length).toBe(2404);
    expect(out[0].content).not.toContain("cortada pelo sistema");
  });

  it("só passando de 4.000 caracteres corta, e avisa a IA", () => {
    const out = toLlmMessages([long(4100)]);
    expect(out[0].content).toContain("cortada pelo sistema");
    expect(out[0].content.startsWith("a".repeat(4000))).toBe(true);
  });
});

describe("mídia (fotos e vídeos)", () => {
  const m = (type: string, direction: "inbound" | "outbound" = "inbound"): HistoryMessage => ({ direction, sender: direction === "inbound" ? "contact" : "human", type, content: null, status: "received" });

  it("conta só fotos e vídeos enviados pelo cliente", () => {
    expect(countMedia([m("image"), m("video"), m("audio"), m("text"), m("image", "outbound")])).toBe(2);
    expect(countMedia([])).toBe(0);
  });

  it("a IA vê um aviso de que chegou foto/vídeo (e a legenda, se houver)", () => {
    const out = toLlmMessages([
      { ...m("image"), content: "sala" },
      m("video"),
    ]);
    expect(out).toEqual([{ role: "user", content: "[o cliente enviou uma foto] sala\n[o cliente enviou um vídeo]" }]);
  });
});

describe("buildSystemPrompt (Carol)", () => {
  it("traz a persona, as regras de preço, a regra de honestidade e os dados já conhecidos", () => {
    const p = buildSystemPrompt({ nome: "Maria", origem: "BH" }, { mediaCount: 2 });
    expect(p).toContain("Você é a Carol");
    expect(p).toContain("consultor de vendas");
    expect(p).toContain("NUNCA fale de dinheiro");
    expect(p).toContain("NUNCA diga que é humana");
    expect(p).toContain("assistente virtual que faz somente a triagem");
    expect(p).toContain("- nome: Maria");
    expect(p).toContain("- destino: (ainda não sabemos)");
    expect(p).toContain("já enviou nesta conversa: 2");
  });

  it("pede só as informações combinadas (nada além) e informa a data de hoje", () => {
    const p = buildSystemPrompt({}, { today: { label: "quinta-feira, 1 de outubro de 2026", iso: "2026-10-01" } });
    for (const key of ["nome", "origem", "destino", "data_mudanca", "bens"]) expect(p).toContain(`- ${key}:`);
    expect(p).toContain("HOJE É: quinta-feira, 1 de outubro de 2026 (2026-10-01)");
    expect(p).toContain("Responda PRIMEIRO ao que o cliente perguntou");
    expect(p).toContain("O NOME do cliente é indispensável");
    for (const gone of ["tipo_servico", "escada_elevador", "observacoes", "itens:"]) expect(p).not.toContain(gone);
  });
});

// ---------------------------------------------------------------------------------------
function makeDeps(opts: {
  config?: Partial<{ aiEnabled: boolean; mode: "shadow" | "auto" }>;
  conversation?: Partial<SdrConversation> | null;
  history?: HistoryMessage[];
  llm?: LlmProvider["generate"];
  allowAuto?: boolean;
  send?: SdrDeps["send"];
  dailyCount?: number;
  claim?: number;
  createDeals?: boolean;
  existingDeal?: string | null;
  createDealFails?: boolean;
  autoAllowlist?: string[] | null;
  latestInbound?: () => string | null;
  nextSeller?: string | null;
  autoAssign?: boolean;
  notifySeller?: SdrDeps["notifySeller"];
} = {}) {
  const calls = {
    inserted: [] as Array<Parameters<SdrStore["insertAiMessage"]>[0]>,
    merged: [] as Array<Record<string, string>>,
    handoffs: 0,
    disabled: 0,
    getConversation: 0,
    created: [] as Array<Parameters<SdrStore["createDeal"]>[0]>,
    linked: [] as Array<[string, string]>,
    synced: [] as string[],
    assigned: [] as Array<[string, string]>,
    filled: [] as Array<[string, unknown]>,
  };
  const conv: SdrConversation | null =
    opts.conversation === null
      ? null
      : { id: CONV, wa_id: "5531988880001", telefone_norm: "5531988880001", status: "ai", ai_enabled: true, assigned_seller_id: null, deal_id: null, qualification: null, ...opts.conversation };

  const store: SdrStore = {
    getConfig: async () => ({ aiEnabled: true, mode: "shadow", ...opts.config }),
    getConversation: async () => {
      calls.getConversation += 1;
      return conv;
    },
    claimPendingInbound: async () => opts.claim ?? 1,
    getHistory: async () => opts.history ?? [{ direction: "inbound", sender: "contact", type: "text", content: "Oi, preciso de uma mudança", status: "received" }],
    insertAiMessage: async (m) => void calls.inserted.push(m),
    mergeQualification: async (_id, patch) => void calls.merged.push(patch as Record<string, string>),
    handoffToHuman: async () => void (calls.handoffs += 1),
    disableAiGlobally: async () => void (calls.disabled += 1),
    countAiMessagesSince: async () => opts.dailyCount ?? 0,
    findOpenDealByPhone: async () => opts.existingDeal ?? null,
    createDeal: async (input) => {
      if (opts.createDealFails) throw new Error("banco fora do ar");
      calls.created.push(input);
      return "deal-novo";
    },
    linkDeal: async (conversationId, dealId) => void calls.linked.push([conversationId, dealId]),
    fillDealGaps: async (dealId, data) => void calls.filled.push([dealId, data]),
    syncDealOwner: async (conversationId) => void calls.synced.push(conversationId),
    getLatestInboundAt: async () => (opts.latestInbound ? opts.latestInbound() : "2026-10-01T14:00:00Z"),
    pickNextSeller: async () => (opts.nextSeller === undefined ? null : opts.nextSeller),
    assignConversation: async (conversationId, sellerId) => void calls.assigned.push([conversationId, sellerId]),
  };
  const generate = vi.fn(
    opts.llm ??
      (async () => ({
        output: {
          reply: "Oi! Sou o assistente da Amitran. De onde para onde será a mudança?",
          handoff: false,
          handoff_reason: null,
          qualification: { nome: null, origem: null, destino: null, data_mudanca: null, data_iso: null, bens: null },
        },
        refusal: false,
        model: "claude-sonnet-5-5",
        usage: { inputTokens: 100, outputTokens: 40 },
      })),
  );
  const deps: SdrDeps = { store, llm: { generate }, send: opts.send, allowAuto: opts.allowAuto ?? false, dailyLimit: 100, createDeals: opts.createDeals ?? false, autoAllowlist: opts.autoAllowlist === undefined ? null : opts.autoAllowlist, autoAssign: opts.autoAssign, notifySeller: opts.notifySeller, now: () => Date.parse("2026-10-01T15:00:00Z") };
  return { deps, calls, generate, conv };
}

const FULL_Q = {
  nome: "Maria Souza", origem: "Santa Maria, Belo Horizonte", destino: "São Joaquim, Belo Horizonte",
  data_mudanca: "02/10/2026", data_iso: "2026-10-02", bens: "Apartamento de 2 quartos, geladeira, fogão, sofá",
};
const out = (over: Record<string, unknown>) => ({
  output: {
    reply: "Ok!", handoff: false, handoff_reason: null,
    qualification: { nome: null, origem: null, destino: null, data_mudanca: null, data_iso: null, bens: null },
    ...over,
  },
  refusal: false, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1 },
});

describe("processConversation — interruptores", () => {
  it("IA global desligada: não faz nada e nem chama a IA", async () => {
    const t = makeDeps({ config: { aiEnabled: false } });
    expect(await processConversation(t.deps, CONV)).toBe("skipped_global_off");
    expect(t.generate).not.toHaveBeenCalled();
    expect(t.calls.inserted).toHaveLength(0);
  });

  it("IA desligada nesta conversa, ou conversa com humano/pausada: não faz nada", async () => {
    for (const conversation of [{ ai_enabled: false }, { status: "human" as const }, { status: "paused" as const }]) {
      const t = makeDeps({ conversation });
      const outcome = await processConversation(t.deps, CONV);
      expect(["skipped_conversation_off", "skipped_not_ai"]).toContain(outcome);
      expect(t.generate).not.toHaveBeenCalled();
    }
  });

  it("conversa inexistente, sem mensagens pendentes ou teto diário: não chama a IA", async () => {
    expect(await processConversation(makeDeps({ conversation: null }).deps, CONV)).toBe("not_found");
    const none = makeDeps({ claim: 0 });
    expect(await processConversation(none.deps, CONV)).toBe("nothing_pending");
    expect(none.generate).not.toHaveBeenCalled();
    const capped = makeDeps({ dailyCount: 100 });
    expect(await processConversation(capped.deps, CONV)).toBe("skipped_daily_limit");
    expect(capped.generate).not.toHaveBeenCalled();
  });
});

describe("processConversation — modo sombra", () => {
  it("guarda RASCUNHO (não envia) e grava só os campos permitidos", async () => {
    const send = vi.fn();
    const t = makeDeps({
      send,
      llm: async () => out({ reply: "Oi Maria! De onde sai a mudança?", qualification: { nome: "Maria", origem: null, destino: null, data_mudanca: null, data_iso: null, bens: null } }),
    });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.inserted).toHaveLength(1);
    expect(t.calls.inserted[0]).toMatchObject({ status: "draft", content: "Oi Maria! De onde sai a mudança?", whatsappMessageId: null });
    expect(t.calls.merged).toEqual([{ nome: "Maria" }]);
    expect(send).not.toHaveBeenCalled();
    expect(t.calls.handoffs).toBe(0);
  });

  it("modo 'auto' sem a trava liberada continua só rascunhando", async () => {
    const send = vi.fn();
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: false, send });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(send).not.toHaveBeenCalled();
    expect(t.calls.inserted[0].status).toBe("draft");
  });

  it("lead qualificado: guarda o rascunho de despedida e passa para humano", async () => {
    const t = makeDeps({ llm: async () => out({ reply: "Obrigado! Um consultor da Amitran vai continuar com você.", handoff: true, handoff_reason: "Lead qualificado" }) });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.handoffs).toBe(1);
    expect(t.calls.inserted[0].payload).toMatchObject({ handoff: true, handoff_reason: "Lead qualificado" });
  });
});

describe("processConversation — filtro de preço", () => {
  it("bloqueia o texto, NÃO salva rascunho utilizável e passa para humano", async () => {
    const t = makeDeps({ llm: async () => out({ reply: "Essa mudança sai por uns R$ 1.500." }) });
    expect(await processConversation(t.deps, CONV)).toBe("blocked_price");
    expect(t.calls.inserted).toHaveLength(1);
    expect(t.calls.inserted[0].status).toBe("failed");
    expect(t.calls.inserted[0].error).toContain("filtro de preço");
    expect(t.calls.handoffs).toBe(1);
  });

  it("no modo automático, o texto com preço NUNCA é enviado: só a mensagem fixa e segura", async () => {
    const send = vi.fn(async () => ({ ok: true, wamid: "wamid.X" }));
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send, llm: async () => out({ reply: "O valor é 900 reais" }) });
    expect(await processConversation(t.deps, CONV)).toBe("blocked_price");
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [unknown, string])[1]).toBe(PRICE_FALLBACK_REPLY);
    expect(JSON.stringify(send.mock.calls)).not.toContain("900");
    expect(t.calls.inserted.map(m => m.status)).toEqual(["failed", "sent"]); // o texto barrado + a mensagem fixa
    expect(t.calls.handoffs).toBe(1);
  });

  it("a mensagem fixa não cai no próprio filtro de preço", async () => {
    const { mentionsPrice } = await import("./guards.js");
    expect(mentionsPrice(PRICE_FALLBACK_REPLY)).toBeNull();
  });

  it("no modo sombra não manda nada ao cliente", async () => {
    const send = vi.fn(async () => ({ ok: true, wamid: "wamid.X" }));
    const t = makeDeps({ config: { mode: "shadow" }, allowAuto: true, send, llm: async () => out({ reply: "O valor é 900 reais" }) });
    await processConversation(t.deps, CONV);
    expect(send).not.toHaveBeenCalled();
  });

  it("se a primeira resposta usa 'valor', pede UMA nova versão e envia a limpa (o cliente não fica sem resposta)", async () => {
    const send = vi.fn(async () => ({ ok: true, wamid: "wamid.OK" }));
    let calls = 0;
    const t = makeDeps({
      config: { mode: "auto" },
      allowAuto: true,
      send,
      llm: async () => {
        calls += 1;
        return out({ reply: calls === 1 ? "Sobre o valor, quem monta é o consultor." : "O consultor de vendas monta o orçamento certinho e envia em seguida. Me conta o tamanho do imóvel?" });
      },
    });
    expect(await processConversation(t.deps, CONV)).toBe("sent");
    expect(t.generate).toHaveBeenCalledTimes(2);
    const secondSystem = (t.generate.mock.calls[1][0] as { system: string }).system;
    expect(secondSystem).toContain("SUA RESPOSTA ANTERIOR FOI BARRADA");
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [unknown, string])[1]).toContain("monta o orçamento certinho");
    expect(t.calls.handoffs).toBe(0);
  });

  it("resposta limpa de primeira: não faz nova tentativa", async () => {
    const t = makeDeps({});
    await processConversation(t.deps, CONV);
    expect(t.generate).toHaveBeenCalledTimes(1);
  });
});

describe("processConversation — modo automático liberado", () => {
  it("envia e grava como enviada", async () => {
    const send = vi.fn(async () => ({ ok: true, wamid: "wamid.OK" }));
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send });
    expect(await processConversation(t.deps, CONV)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(t.calls.inserted[0]).toMatchObject({ status: "sent", whatsappMessageId: "wamid.OK" });
  });

  it("Meta demorou (sem confirmação): grava como enviada, mantém a IA e NÃO passa para humano", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "A Meta demorou demais para responder", unconfirmed: true }));
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send });
    expect(await processConversation(t.deps, CONV)).toBe("sent");
    expect(t.calls.inserted[0]).toMatchObject({ status: "sent", whatsappMessageId: null });
    expect((t.calls.inserted[0] as { payload: Record<string, unknown> }).payload.send_unconfirmed).toBe(true);
    expect(t.calls.handoffs).toBe(0);
  });

  it("falha no envio: grava 'failed' e passa para humano", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "Meta recusou" }));
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send });
    expect(await processConversation(t.deps, CONV)).toBe("send_failed");
    expect(t.calls.inserted[0]).toMatchObject({ status: "failed", error: "Meta recusou" });
    expect(t.calls.handoffs).toBe(1);
  });
});

describe("envio automático só para números liberados", () => {
  const phone = "5531988880001";
  const send = () => vi.fn(async () => ({ ok: true, wamid: "wamid.OK" }));

  it("isAutoAllowed: lista vazia = ninguém; null = todos; compara telefone de qualquer formato", () => {
    const c = { telefone_norm: phone, wa_id: "553188880001" };
    expect(isAutoAllowed([], c)).toBe(false);
    expect(isAutoAllowed(null, c)).toBe(true);
    expect(isAutoAllowed(["5531988880001"], c)).toBe(true);
    expect(isAutoAllowed(["5531999990000"], c)).toBe(false);
    expect(isAutoAllowed(["5531988880001"], { telefone_norm: null, wa_id: "553188880001" })).toBe(true);
  });

  it("número liberado + modo automático + trava aberta: envia", async () => {
    const s = send();
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send: s, autoAllowlist: [phone] });
    expect(await processConversation(t.deps, CONV)).toBe("sent");
    expect(s).toHaveBeenCalledTimes(1);
  });

  it("número FORA da lista continua só em rascunho, mesmo com o modo automático ligado", async () => {
    const s = send();
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send: s, autoAllowlist: ["5531999990000"] });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(s).not.toHaveBeenCalled();
    expect(t.calls.inserted[0].status).toBe("draft");
  });

  it("lista vazia (padrão): ninguém recebe automático", async () => {
    const s = send();
    const t = makeDeps({ config: { mode: "auto" }, allowAuto: true, send: s, autoAllowlist: [] });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(s).not.toHaveBeenCalled();
  });
});

describe("mensagem nova do cliente durante o processamento", () => {
  it("descarta a resposta antiga (quem trata a mensagem nova responde com a conversa completa)", async () => {
    const s = vi.fn(async () => ({ ok: true, wamid: "wamid.X" }));
    let n = 0;
    const t = makeDeps({
      config: { mode: "auto" }, allowAuto: true, send: s, autoAllowlist: null, createDeals: true,
      latestInbound: () => (++n === 1 ? "2026-10-01T14:00:00Z" : "2026-10-01T14:00:09Z"),
      llm: async () => out({ qualification: FULL_Q }),
    });
    expect(await processConversation(t.deps, CONV)).toBe("superseded");
    expect(s).not.toHaveBeenCalled();
    expect(t.calls.inserted).toHaveLength(0);
    expect(t.calls.merged).toHaveLength(0);
    expect(t.calls.created).toHaveLength(0);
  });
});

describe("processConversation — falhas da IA", () => {
  it("chave inválida ou sem saldo: desliga a IA para todos e avisa na conversa", async () => {
    for (const kind of ["auth", "billing"] as const) {
      const t = makeDeps({ llm: async () => { throw new LlmError("Chave da IA inválida", kind); } });
      expect(await processConversation(t.deps, CONV)).toBe("llm_error");
      expect(t.calls.disabled).toBe(1);
      expect(t.calls.inserted[0].status).toBe("failed");
      expect(t.calls.inserted[0].error).toContain("IA desligada automaticamente");
      expect(t.calls.handoffs).toBe(1);
    }
  });

  it("erro passageiro: não desliga a IA global, mas passa a conversa para humano", async () => {
    const t = makeDeps({ llm: async () => { throw new LlmError("Falha ao consultar a IA", "other"); } });
    expect(await processConversation(t.deps, CONV)).toBe("llm_error");
    expect(t.calls.disabled).toBe(0);
    expect(t.calls.handoffs).toBe(1);
  });

  it("recusa e resposta fora do formato: registra e passa para humano", async () => {
    const refused = makeDeps({ llm: async () => ({ ...out({}), refusal: true }) });
    expect(await processConversation(refused.deps, CONV)).toBe("llm_refused");
    expect(refused.calls.handoffs).toBe(1);

    const bad = makeDeps({ llm: async () => ({ ...out({}), output: { reply: 123 } }) });
    expect(await processConversation(bad.deps, CONV)).toBe("invalid_output");
    expect(bad.calls.handoffs).toBe(1);
  });
});

describe("processConversation — re-checagem antes de gravar", () => {
  it("se um humano assumiu enquanto a IA pensava, descarta o rascunho", async () => {
    let n = 0;
    const t = makeDeps({});
    t.deps.store.getConversation = async () => {
      n += 1;
      return { ...(t.conv as SdrConversation), status: n === 1 ? "ai" : "human" };
    };
    expect(await processConversation(t.deps, CONV)).toBe("discarded_changed");
    expect(t.calls.inserted).toHaveLength(0);
    expect(t.calls.merged).toHaveLength(0);
  });

  it("se o interruptor geral foi desligado nesse meio tempo, descarta", async () => {
    let n = 0;
    const t = makeDeps({});
    t.deps.store.getConfig = async () => {
      n += 1;
      return { aiEnabled: n === 1, mode: "shadow" };
    };
    expect(await processConversation(t.deps, CONV)).toBe("discarded_changed");
    expect(t.calls.inserted).toHaveLength(0);
  });
});

describe("criação do negócio no funil (lead qualificado)", () => {
  const qualified = () => out({ reply: "Perfeito, Maria! Um consultor de vendas assume em seguida com o orçamento.", handoff: true, handoff_reason: "Lead qualificado", qualification: FULL_Q });

  it("cria o negócio com nome, telefone, origem, destino e data; SEM valor e SEM tipo de serviço", async () => {
    const t = makeDeps({ createDeals: true, llm: async () => qualified() });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.created).toEqual([
      {
        conversationId: CONV,
        assignedSellerId: null,
        nome: "Maria Souza",
        telefone: "+55 31 98888-0001",
        origem: "Santa Maria, Belo Horizonte",
        destino: "São Joaquim, Belo Horizonte",
        dataMudancaIso: "2026-10-02",
      },
    ]);
    expect(t.calls.linked).toEqual([[CONV, "deal-novo"]]);
    expect(t.calls.synced).toEqual([CONV]); // garante que o dono acompanha o responsável atual
    expect(Object.keys(t.calls.created[0])).not.toContain("valor");
    expect(Object.keys(t.calls.created[0])).not.toContain("tipoServico");
    expect(t.calls.inserted[0].payload).toMatchObject({ deal: "created" });
  });

  it("o negócio fica com o vendedor responsável, se a conversa já tiver um", async () => {
    const t = makeDeps({ createDeals: true, conversation: { assigned_seller_id: "u-seller" }, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.created[0].assignedSellerId).toBe("u-seller");
  });

  it("foto/vídeo no lugar da lista de bens também qualifica", async () => {
    const withPhoto: HistoryMessage[] = [
      { direction: "inbound", sender: "contact", type: "text", content: "Oi, sou a Maria", status: "received" },
      { direction: "inbound", sender: "contact", type: "image", content: null, status: "received" },
    ];
    const t = makeDeps({ createDeals: true, history: withPhoto, llm: async () => out({ qualification: { ...FULL_Q, bens: null } }) });
    await processConversation(t.deps, CONV);
    expect(t.calls.created).toHaveLength(1);
  });

  it("faltando qualquer informação essencial (ex.: nome, ou bens sem foto), NÃO cria", async () => {
    for (const missing of ["nome", "origem", "destino", "data_mudanca", "bens"] as const) {
      // "sem data" = sem o texto E sem a data de calendário (uma data real já conta como data conhecida).
      const gap = missing === "data_mudanca" ? { data_mudanca: null, data_iso: null } : { [missing]: null };
      const t = makeDeps({ createDeals: true, llm: async () => out({ qualification: { ...FULL_Q, ...gap } }) });
      await processConversation(t.deps, CONV);
      expect(t.calls.created).toHaveLength(0);
    }
  });

  it("acumula informações de turnos anteriores para qualificar", async () => {
    const t = makeDeps({
      createDeals: true,
      conversation: { qualification: { nome: "Maria Souza", origem: "Santa Maria", destino: "São Joaquim", data_mudanca: "02/10" } },
      llm: async () => out({ qualification: { ...FULL_Q, nome: null, origem: null, destino: null, data_mudanca: null, data_iso: null } }),
    });
    await processConversation(t.deps, CONV);
    expect(t.calls.created).toHaveLength(1);
    expect(t.calls.created[0].dataMudancaIso).toBeNull();
  });

  it("não cria de novo se a conversa já tem negócio, nem se a trava estiver desligada", async () => {
    const already = makeDeps({ createDeals: true, conversation: { deal_id: "deal-antigo" }, llm: async () => qualified() });
    await processConversation(already.deps, CONV);
    expect(already.calls.created).toHaveLength(0);
    expect(already.calls.linked).toHaveLength(0);

    const off = makeDeps({ createDeals: false, llm: async () => qualified() });
    await processConversation(off.deps, CONV);
    expect(off.calls.created).toHaveLength(0);
  });

  it("se já existe um negócio ABERTO do mesmo telefone, liga a ele em vez de duplicar", async () => {
    const t = makeDeps({ createDeals: true, existingDeal: "deal-existente", llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.created).toHaveLength(0);
    expect(t.calls.linked).toEqual([[CONV, "deal-existente"]]);
    expect(t.calls.synced).toHaveLength(0); // negócio que já existia NÃO muda de dono
    expect(t.calls.inserted[0].payload).toMatchObject({ deal: "linked" });
  });

  it("data inventada, passada ou impossível é descartada (o negócio nasce sem data)", async () => {
    for (const bad of ["2020-01-01", "2026-02-31", "amanhã", "2026-09-30"]) {
      const t = makeDeps({ createDeals: true, llm: async () => out({ qualification: { ...FULL_Q, data_iso: bad } }) });
      await processConversation(t.deps, CONV);
      expect(t.calls.created[0].dataMudancaIso).toBeNull();
    }
  });

  it("falha ao criar o negócio NÃO derruba o rascunho nem a conversa", async () => {
    const t = makeDeps({ createDeals: true, createDealFails: true, llm: async () => qualified() });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.inserted[0].status).toBe("draft");
    expect(t.calls.linked).toHaveLength(0);
  });

  it("cria mesmo que o filtro de preço bloqueie o texto (os dados são seguros)", async () => {
    const t = makeDeps({ createDeals: true, llm: async () => out({ reply: "Sai por R$ 900", qualification: FULL_Q }) });
    expect(await processConversation(t.deps, CONV)).toBe("blocked_price");
    expect(t.calls.created).toHaveLength(1);
  });
});

describe("isValidIsoDate", () => {
  it("só aceita datas reais, e futuras quando 'hoje' é informado", async () => {
    const { isValidIsoDate } = await import("./guards.js");
    expect(isValidIsoDate("2026-10-02")).toBe(true);
    expect(isValidIsoDate("2026-10-02", "2026-10-01")).toBe(true);
    expect(isValidIsoDate("2026-10-01", "2026-10-01")).toBe(true);
    expect(isValidIsoDate("2026-09-30", "2026-10-01")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("02/10/2026")).toBe(false);
  });
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("horário comercial (Brasília, seg-sex 8h-18h)", () => {
  // 2026-10-01 é quinta-feira. 11:00Z = 08:00 BRT.
  it("dentro do horário", () => {
    expect(isBusinessHoursBrt(Date.parse("2026-10-01T11:00:00Z"))).toBe(true); // 08:00
    expect(isBusinessHoursBrt(Date.parse("2026-10-01T20:59:00Z"))).toBe(true); // 17:59
  });
  it("fora do horário no mesmo dia", () => {
    expect(isBusinessHoursBrt(Date.parse("2026-10-01T10:59:00Z"))).toBe(false); // 07:59
    expect(isBusinessHoursBrt(Date.parse("2026-10-01T21:00:00Z"))).toBe(false); // 18:00
  });
  it("fim de semana nunca", () => {
    expect(isBusinessHoursBrt(Date.parse("2026-10-03T15:00:00Z"))).toBe(false); // sábado
    expect(isBusinessHoursBrt(Date.parse("2026-10-04T15:00:00Z"))).toBe(false); // domingo
  });
  it("usa o dia de Brasília, não o UTC", () => {
    expect(isBusinessHoursBrt(Date.parse("2026-10-05T01:00:00Z"))).toBe(false); // domingo 22:00 BRT
    expect(isBusinessHoursBrt(Date.parse("2026-10-05T12:00:00Z"))).toBe(true); // segunda 09:00 BRT
    expect(isBusinessHoursBrt(Date.parse("2026-10-10T01:00:00Z"))).toBe(false); // sexta 22:00 BRT
  });
});

describe("tom da Carol (instruções)", () => {
  const p = buildSystemPrompt({});
  it("cumprimenta normal e não imita o cliente", () => {
    expect(p).toContain('NUNCA alongue letras');
    expect(p).toContain('"oii"');
  });
  it("usa o nome e cita o consultor com moderação", () => {
    expect(p).toContain("USE O NOME COM MODERAÇÃO");
    expect(p).toContain("MENCIONE O CONSULTOR DE VENDAS SÓ QUANDO FAZ SENTIDO");
  });
  it("pergunta origem/destino uma vez e aceita só a cidade", () => {
    expect(p).toContain("peça UMA vez");
    expect(p).toContain("NUNCA pergunte de novo sobre bairro");
  });
  it("traz os princípios de relacionamento, abaixo das regras absolutas", () => {
    expect(p).toContain("JEITO DE ATENDER (relacionamento)");
    expect(p).toContain("NUNCA valem mais do que as REGRAS ABSOLUTAS");
    expect(p.indexOf("REGRAS ABSOLUTAS")).toBeLessThan(p.indexOf("JEITO DE ATENDER"));
    expect(p).toContain("sem urgência falsa");
  });
  it("ensina a falar de orçamento sem as palavras proibidas", () => {
    expect(p).toContain('o consultor de vendas monta o orçamento certinho e envia em seguida');
    expect(p).toContain('Nunca escreva frases como "sobre o valor');
  });
  it("mantém as regras de segurança (preço, honestidade)", () => {
    expect(p).toContain("NUNCA fale de dinheiro");
    expect(p).toContain("NUNCA diga que é humana");
  });
});

describe("prompt fora do horário comercial", () => {
  it("avisa o próximo horário comercial só quando está fora", () => {
    const fora = buildSystemPrompt({}, { businessHours: false });
    expect(fora).toContain("FORA DO HORÁRIO COMERCIAL");
    expect(fora).toContain("próximo horário comercial");
  });
  it("não muda nada em horário comercial (ou sem a informação)", () => {
    expect(buildSystemPrompt({}, { businessHours: true })).not.toContain("FORA DO HORÁRIO COMERCIAL");
    expect(buildSystemPrompt({})).not.toContain("FORA DO HORÁRIO COMERCIAL");
  });
});

describe("distribuição automática do lead e aviso ao vendedor", () => {
  const qualified = () => out({ reply: "Perfeito, Maria! Um consultor assume em seguida.", handoff: true, handoff_reason: "Lead qualificado", qualification: FULL_Q });

  it("lead novo sem dono vai para o vendedor da vez e ele é avisado com os dados do lead", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", notifySeller: notify, llm: async () => qualified() });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.assigned).toEqual([[CONV, "u-gabriel"]]);
    expect(t.calls.created[0].assignedSellerId).toBe("u-gabriel");
    expect(notify).toHaveBeenCalledWith({
      sellerId: "u-gabriel",
      conversationId: CONV,
      nome: "Maria Souza",
      origem: "Santa Maria, Belo Horizonte",
      destino: "São Joaquim, Belo Horizonte",
      dataLabel: expect.any(String),
    });
  });

  it("se a conversa já tem responsável, respeita (não sorteia) e avisa esse vendedor", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-outro", notifySeller: notify, conversation: { assigned_seller_id: "u-raufle" }, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.assigned).toHaveLength(0);
    expect(t.calls.created[0].assignedSellerId).toBe("u-raufle");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ sellerId: "u-raufle" }));
  });

  it("o resultado do aviso fica gravado no registro da mensagem (para investigar depois)", async () => {
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", notifySeller: async () => ({ outcome: "failed", error: "131042" }), llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.inserted[0].payload).toMatchObject({ deal: "created", notify: { outcome: "failed", error: "131042" } });
    const boom = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", notifySeller: async () => { throw new Error("rede"); }, llm: async () => qualified() });
    await processConversation(boom.deps, CONV);
    expect(boom.calls.inserted[0].payload).toMatchObject({ notify: { outcome: "exception" } });
  });

  it("negócio que já existia: completa só o que faltava (data, origem, destino) com o que a conversa descobriu", async () => {
    const t = makeDeps({ createDeals: true, existingDeal: "deal-antigo", llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.filled).toEqual([["deal-antigo", { origem: "Santa Maria, Belo Horizonte", destino: "São Joaquim, Belo Horizonte", dataMudancaIso: "2026-10-02" }]]);
    expect(t.calls.created).toHaveLength(0);
  });

  it("com a distribuição desligada o lead fica sem vendedor e ninguém é avisado", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: false, nextSeller: "u-gabriel", notifySeller: notify, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.assigned).toHaveLength(0);
    expect(t.calls.created[0].assignedSellerId).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it("sem vendedores cadastrados cria o lead mesmo assim (fica com o Head) e não avisa", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: null, notifySeller: notify, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.created).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("se o aviso falhar, a conversa e o lead seguem normalmente", async () => {
    const notify = vi.fn(async () => {
      throw new Error("whatsapp fora do ar");
    });
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", notifySeller: notify, llm: async () => qualified() });
    expect(await processConversation(t.deps, CONV)).toBe("draft_saved");
    expect(t.calls.created).toHaveLength(1);
    expect(t.calls.inserted[0].payload).toMatchObject({ deal: "created" });
  });

  it("cliente que já tem negócio aberto: só liga, não sorteia vendedor e não avisa", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", existingDeal: "deal-antigo", notifySeller: notify, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(t.calls.assigned).toHaveLength(0);
    expect(t.calls.linked).toEqual([[CONV, "deal-antigo"]]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("se criar o negócio falhar, não avisa ninguém", async () => {
    const notify = vi.fn(async () => {});
    const t = makeDeps({ createDeals: true, autoAssign: true, nextSeller: "u-gabriel", createDealFails: true, notifySeller: notify, llm: async () => qualified() });
    await processConversation(t.deps, CONV);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("trava do nome (não chamar o cliente pelo nome em toda mensagem)", () => {
  const ai = (content: string, status = "delivered"): HistoryMessage => ({ direction: "outbound", sender: "ai", type: "text", content, status });
  const contact = (content: string): HistoryMessage => ({ direction: "inbound", sender: "contact", type: "text", content, status: "received" });

  it("detecta o primeiro nome nas últimas 2 respostas enviadas (sem ligar para acento ou maiúscula)", () => {
    expect(usedNameRecently([ai("Prazer, Lucas! De onde sai?")], "Lucas Rébula")).toBe(true);
    expect(usedNameRecently([ai("Olá, LÚCAS!")], "lucas")).toBe(true);
    expect(usedNameRecently([ai("Oi, Maria"), ai("Anotado, de onde sai?")], "Maria")).toBe(true);
  });
  it("não detecta quando o nome está só em mensagem mais antiga que as 2 últimas", () => {
    expect(usedNameRecently([ai("Prazer, Lucas!"), ai("De onde sai?"), ai("E para onde vai?")], "Lucas")).toBe(false);
  });
  it("ignora mensagens do cliente, rascunhos e falhas; não confunde nomes parecidos", () => {
    expect(usedNameRecently([contact("Sou o Lucas")], "Lucas")).toBe(false);
    expect(usedNameRecently([ai("Oi, Lucas!", "draft")], "Lucas")).toBe(false);
    expect(usedNameRecently([ai("Oi, Lucas!", "failed")], "Lucas")).toBe(false);
    expect(usedNameRecently([ai("Falamos com a Lucia ontem")], "Lu")).toBe(false);
    expect(usedNameRecently([ai("Oi, Lucas!")], "Luc")).toBe(false);
  });
  it("sem nome conhecido: nada a evitar", () => {
    expect(usedNameRecently([ai("Olá!")], undefined)).toBe(false);
    expect(usedNameRecently([ai("Olá!")], "")).toBe(false);
  });
  it("o prompt traz o aviso só quando precisa", () => {
    expect(buildSystemPrompt({}, { avoidName: true })).toContain("NÃO use o nome dele");
    expect(buildSystemPrompt({}, { avoidName: false })).not.toContain("NÃO use o nome dele");
    expect(buildSystemPrompt({})).not.toContain("NÃO use o nome dele");
  });
  it("a IA recebe o aviso quando acabou de usar o nome", async () => {
    const t = makeDeps({
      conversation: { qualification: { nome: "Lucas" } },
      history: [contact("Sou o Lucas"), ai("Prazer, Lucas! De onde sai a mudança?"), contact("de BH")],
    });
    await processConversation(t.deps, CONV);
    expect((t.generate.mock.calls[0][0] as { system: string }).system).toContain("NÃO use o nome dele");
  });
});

describe("encerrar quando os dados essenciais já estão completos", () => {
  const FULL_KNOWN = { nome: "Lucas", origem: "Belo Horizonte", destino: "São Paulo", data_mudanca: "próxima terça" };
  const withPhoto: HistoryMessage[] = [
    { direction: "inbound", sender: "contact", type: "text", content: "vc é um robô?", status: "received" },
    { direction: "inbound", sender: "contact", type: "image", content: null, status: "received" },
  ];

  it("dados completos + foto: a IA recebe a ordem de encerrar e encaminhar nesta resposta", async () => {
    const t = makeDeps({ conversation: { qualification: FULL_KNOWN }, history: withPhoto });
    await processConversation(t.deps, CONV);
    const system = (t.generate.mock.calls[0][0] as { system: string }).system;
    expect(system).toContain("DADOS COMPLETOS");
    expect(system).toContain("NÃO peça mais nada");
    expect(system).toContain("handoff = true");
  });

  it("falta qualquer informação essencial: sem a ordem de encerrar", async () => {
    for (const missing of ["nome", "origem", "destino", "data_mudanca"] as const) {
      const { [missing]: _omit, ...partial } = FULL_KNOWN;
      const t = makeDeps({ conversation: { qualification: partial }, history: withPhoto });
      await processConversation(t.deps, CONV);
      expect((t.generate.mock.calls[0][0] as { system: string }).system).not.toContain("DADOS COMPLETOS");
    }
  });

  it("sem lista dos bens nem foto: sem a ordem de encerrar", async () => {
    const t = makeDeps({ conversation: { qualification: FULL_KNOWN } });
    await processConversation(t.deps, CONV);
    expect((t.generate.mock.calls[0][0] as { system: string }).system).not.toContain("DADOS COMPLETOS");
  });

  it("lista dos bens por escrito também conta", async () => {
    const t = makeDeps({ conversation: { qualification: { ...FULL_KNOWN, bens: "apartamento de 2 quartos, geladeira e sofá" } } });
    await processConversation(t.deps, CONV);
    expect((t.generate.mock.calls[0][0] as { system: string }).system).toContain("DADOS COMPLETOS");
  });

  it("o prompt só traz o aviso quando pedido", () => {
    expect(buildSystemPrompt({}, { qualified: true })).toContain("DADOS COMPLETOS");
    expect(buildSystemPrompt({}, { qualified: false })).not.toContain("DADOS COMPLETOS");
    expect(buildSystemPrompt({})).not.toContain("DADOS COMPLETOS");
  });
});
