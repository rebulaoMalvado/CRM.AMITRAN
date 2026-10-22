import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InboundStore } from "./ingest.js";
import { phoneKey } from "./phone.js";
import { TABLES } from "./company.js";
import type { AssignStore } from "./assign-handler.js";
import type { MediaStore } from "./media-handler.js";
import type { PropostaStore } from "./proposta-handler.js";
import type { SdrStore } from "./sdr/engine.js";
import type { SdrConfigStore, SdrConversationStore } from "./sdr/admin-handlers.js";
import type { AuthUser, SendStore } from "./send-handler.js";

/**
 * Cliente do Supabase com a chave de SERVIDOR (service_role). Esta chave ignora a
 * segurança (RLS), por isso ela vive APENAS aqui no backend, no cofre de variáveis
 * da Vercel — nunca no frontend e nunca com prefixo VITE_.
 */
export function createAdminClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  // A URL do projeto não é segredo; aceitamos também a variável que o frontend já usa.
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase não configurado no servidor (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SupabaseStoreOptions {
  /** Telefones (phoneKey) da equipe: conversas deles nascem com a IA DESLIGADA (a assistente nunca atende vendedor). */
  aiOffPhoneKeys?: string[];
}

export function createSupabaseStore(db: SupabaseClient, options: SupabaseStoreOptions = {}): InboundStore {
  return {
    async upsertConversation({ waId, telefoneNorm, contactName }) {
      // Conversa NOVA: nasce com a IA ligada só se o interruptor geral estiver ligado
      // (senão nasce 'human', IA off, sem dono). Conversa que já existe NÃO muda de status.
      const { data: config } = await db.from("crm_sdr_config").select("ai_enabled").eq("id", 1).maybeSingle();
      const isTeam = (options.aiOffPhoneKeys ?? []).includes(telefoneNorm);
      const aiOn = config?.ai_enabled === true && !isTeam;

      const created: Record<string, unknown> = {
        wa_id: waId,
        telefone_norm: telefoneNorm,
        ai_enabled: aiOn,
        status: aiOn ? "ai" : "human",
      };
      if (contactName) created.contact_name = contactName;

      const { data: inserted, error: insertError } = await db
        .from("crm_conversations")
        .upsert(created, { onConflict: "wa_id", ignoreDuplicates: true })
        .select("id");
      if (insertError) throw new Error(`criar conversa: ${insertError.message}`);
      if (inserted && inserted.length > 0) return inserted[0].id as string;

      // Já existia: só atualiza telefone e nome (se veio), sem tocar em status/IA/dono.
      const updates: Record<string, unknown> = { telefone_norm: telefoneNorm };
      if (contactName) updates.contact_name = contactName;
      const { data, error } = await db.from("crm_conversations").update(updates).eq("wa_id", waId).select("id").single();
      if (error) throw new Error(`upsert conversa: ${error.message}`);
      return data.id as string;
    },

    async insertInboundMessage({ conversationId, message }) {
      const { data, error } = await db
        .from("crm_messages")
        .upsert(
          {
            conversation_id: conversationId,
            direction: "inbound",
            sender: "contact",
            type: message.type,
            content: message.content,
            payload: message.payload,
            whatsapp_message_id: message.whatsappMessageId,
            status: "received",
            wa_timestamp: message.waTimestamp,
          },
          { onConflict: "whatsapp_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`gravar mensagem: ${error.message}`);
      // Se era duplicada, o banco ignora e não devolve linha.
      return (data?.length ?? 0) > 0;
    },

    async touchConversation(conversationId, at) {
      const forward = async (column: "last_inbound_at" | "last_message_at") => {
        const { error } = await db
          .from("crm_conversations")
          .update({ [column]: at })
          .eq("id", conversationId)
          .or(`${column}.is.null,${column}.lt.${at}`);
        if (error) throw new Error(`atualizar conversa: ${error.message}`);
      };
      await forward("last_inbound_at");
      await forward("last_message_at");
    },

    async insertOutboundEcho({ conversationId, echo }) {
      const { data, error } = await db
        .from("crm_messages")
        .upsert(
          {
            conversation_id: conversationId,
            direction: "outbound",
            sender: "human", // digitada por uma pessoa no app do celular (sem usuário do CRM)
            type: echo.type,
            content: echo.content,
            payload: echo.payload,
            whatsapp_message_id: echo.whatsappMessageId,
            status: "sent",
            wa_timestamp: echo.waTimestamp,
          },
          { onConflict: "whatsapp_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`gravar mensagem do celular: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async markHumanActivity(conversationId, at) {
      const { error: statusError } = await db
        .from("crm_conversations")
        .update({ status: "human" })
        .eq("id", conversationId);
      if (statusError) throw new Error(`atualizar conversa: ${statusError.message}`);

      const { error: touchError } = await db
        .from("crm_conversations")
        .update({ last_message_at: at })
        .eq("id", conversationId)
        .or(`last_message_at.is.null,last_message_at.lt.${at}`);
      if (touchError) throw new Error(`atualizar conversa: ${touchError.message}`);
    },

    async applyStatus({ whatsappMessageId, status, allowedPrevious, errorText }) {
      const changes: Record<string, unknown> = { status };
      if (errorText) changes.error = errorText;

      const { data, error } = await db
        .from("crm_messages")
        .update(changes)
        .eq("whatsapp_message_id", whatsappMessageId)
        .eq("direction", "outbound")
        .in("status", allowedPrevious)
        .select("id");
      if (error) throw new Error(`atualizar status: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}

/**
 * Confere o token de login (o mesmo do CRM) e descobre o papel do usuário.
 * A checagem é feita no servidor de login do Supabase — não confiamos no que o navegador diz.
 */
export function createAuthenticator(db: SupabaseClient) {
  return async (jwt: string): Promise<AuthUser | null> => {
    const { data: userData, error } = await db.auth.getUser(jwt);
    if (error || !userData?.user) return null;

    const { data: profile } = await db
      .from(TABLES.profiles)
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!profile || (profile.role !== "head" && profile.role !== "vendedor")) return null;
    return { id: userData.user.id, role: profile.role };
  };
}

export function createSendStore(db: SupabaseClient): SendStore {
  return {
    async getConversation(id) {
      const { data, error } = await db
        .from("crm_conversations")
        .select("id, wa_id, telefone_norm, assigned_seller_id, last_inbound_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`buscar conversa: ${error.message}`);
      return data;
    },

    async insertOutboundMessage({ conversationId, userId, content, whatsappMessageId, status, error, type, payload }) {
      const { error: insertError } = await db.from("crm_messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        sender: "human",
        sender_user_id: userId,
        type: type ?? "text",
        ...(payload ? { payload } : {}),
        content,
        whatsapp_message_id: whatsappMessageId,
        status,
        error,
      });
      if (insertError) throw new Error(`gravar mensagem enviada: ${insertError.message}`);
    },

    async markHumanReplied(conversationId, at) {
      // Humano respondeu => a IA sai de cena nesta conversa.
      const { error: statusError } = await db
        .from("crm_conversations")
        .update({ status: "human" })
        .eq("id", conversationId);
      if (statusError) throw new Error(`atualizar conversa: ${statusError.message}`);

      const { error: touchError } = await db
        .from("crm_conversations")
        .update({ last_message_at: at })
        .eq("id", conversationId)
        .or(`last_message_at.is.null,last_message_at.lt.${at}`);
      if (touchError) throw new Error(`atualizar conversa: ${touchError.message}`);
    },
  };
}

/**
 * O negócio ligado a uma conversa tem SEMPRE o mesmo dono da conversa: o vendedor responsável
 * ou, se a conversa estiver sem dono, o Head (que é quem distribui).
 */
async function syncLinkedDealOwner(db: SupabaseClient, conversationId: string): Promise<void> {
  const { data: conversation, error } = await db
    .from("crm_conversations")
    .select("assigned_seller_id, deal_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`ler conversa: ${error.message}`);
  if (!conversation?.deal_id) return;

  let owner = conversation.assigned_seller_id as string | null;
  if (!owner) {
    const { data: head } = await db
      .from(TABLES.profiles)
      .select("id")
      .eq("role", "head")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    owner = (head?.id as string | undefined) ?? null;
  }
  if (!owner) return;

  // Negócio na Lixeira (deleted_at preenchido) não muda de dono.
  const { error: dealError } = await db
    .from(TABLES.deals)
    .update({ seller_id: owner })
    .eq("id", conversation.deal_id)
    .is("deleted_at", null)
    .neq("seller_id", owner);
  if (dealError) throw new Error(`mover negócio: ${dealError.message}`);
}

export function createAssignStore(db: SupabaseClient): AssignStore {
  return {
    async getProfileRole(userId) {
      const { data, error } = await db.from(TABLES.profiles).select("role").eq("id", userId).maybeSingle();
      if (error) throw new Error(`buscar perfil: ${error.message}`);
      return data?.role === "head" || data?.role === "vendedor" ? data.role : null;
    },

    async conversationExists(id) {
      const { data, error } = await db.from("crm_conversations").select("id").eq("id", id).maybeSingle();
      if (error) throw new Error(`buscar conversa: ${error.message}`);
      return !!data;
    },

    async setAssignedSeller(conversationId, sellerId) {
      const { error } = await db
        .from("crm_conversations")
        .update({ assigned_seller_id: sellerId })
        .eq("id", conversationId);
      if (error) throw new Error(`atribuir conversa: ${error.message}`);

      // O negócio ligado à conversa acompanha SEMPRE o responsável (inclusive na troca entre vendedores).
      await syncLinkedDealOwner(db, conversationId);
    },
  };
}

export interface SdrStoreOptions {
  /** ids de perfil dos vendedores que entram no revezamento de leads (ver SDR_SELLER_POOL). */
  sellerPoolIds?: string[];
}

export function createSdrStore(db: SupabaseClient, options: SdrStoreOptions = {}): SdrStore {
  return {
    async getConfig() {
      const { data, error } = await db.from("crm_sdr_config").select("ai_enabled, mode").eq("id", 1).maybeSingle();
      if (error) throw new Error(`ler config da IA: ${error.message}`);
      // Sem linha de configuração: IA desligada (padrão seguro).
      return { aiEnabled: data?.ai_enabled === true, mode: data?.mode === "auto" ? "auto" : "shadow" };
    },

    async getConversation(id) {
      const { data, error } = await db
        .from("crm_conversations")
        .select("id, wa_id, telefone_norm, status, ai_enabled, assigned_seller_id, deal_id, qualification")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`buscar conversa: ${error.message}`);
      if (!data?.deal_id) return data;

      // Negócio ligado que foi para a Lixeira conta como "sem negócio": assim a IA acha outro aberto
      // do mesmo telefone ou cria um novo (e o novo substitui o vínculo antigo).
      const { data: linked, error: linkedError } = await db
        .from(TABLES.deals)
        .select("deleted_at")
        .eq("id", data.deal_id)
        .maybeSingle();
      if (linkedError) throw new Error(`buscar negócio da conversa: ${linkedError.message}`);
      return linked && linked.deleted_at === null ? data : { ...data, deal_id: null };
    },

    async claimPendingInbound(conversationId) {
      const { data, error } = await db
        .from("crm_messages")
        .update({ processed_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound")
        .is("processed_at", null)
        .select("id");
      if (error) throw new Error(`reservar mensagens: ${error.message}`);
      return data?.length ?? 0;
    },

    async getHistory(conversationId, limit) {
      const { data, error } = await db
        .from("crm_messages")
        .select("direction, sender, type, content, status")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`ler histórico: ${error.message}`);
      return (data ?? []).reverse();
    },

    async insertAiMessage({ conversationId, content, status, error, whatsappMessageId, payload }) {
      const { error: insertError } = await db.from("crm_messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        sender: "ai",
        type: "text",
        content,
        payload,
        whatsapp_message_id: whatsappMessageId,
        status,
        error,
      });
      if (insertError) throw new Error(`gravar mensagem da IA: ${insertError.message}`);

      // Mensagem realmente enviada ao cliente: a conversa sobe na lista (nunca anda para trás).
      if (status === "sent") {
        const at = new Date().toISOString();
        const { error: touchError } = await db
          .from("crm_conversations")
          .update({ last_message_at: at })
          .eq("id", conversationId)
          .or(`last_message_at.is.null,last_message_at.lt.${at}`);
        if (touchError) throw new Error(`atualizar conversa: ${touchError.message}`);
      }
    },

    async getLatestInboundAt(conversationId) {
      const { data, error } = await db
        .from("crm_messages")
        .select("created_at")
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`ler última mensagem do cliente: ${error.message}`);
      return (data?.created_at as string | undefined) ?? null;
    },

    async mergeQualification(conversationId, patch) {
      const { data, error } = await db.from("crm_conversations").select("qualification").eq("id", conversationId).maybeSingle();
      if (error) throw new Error(`ler dados do lead: ${error.message}`);
      const merged = { ...((data?.qualification as Record<string, unknown>) ?? {}), ...patch };
      const { error: updateError } = await db.from("crm_conversations").update({ qualification: merged }).eq("id", conversationId);
      if (updateError) throw new Error(`gravar dados do lead: ${updateError.message}`);
    },

    async handoffToHuman(conversationId) {
      const { error } = await db.from("crm_conversations").update({ status: "human" }).eq("id", conversationId);
      if (error) throw new Error(`passar para humano: ${error.message}`);
    },

    async disableAiGlobally() {
      const { error } = await db.from("crm_sdr_config").update({ ai_enabled: false }).eq("id", 1);
      if (error) throw new Error(`desligar a IA: ${error.message}`);
    },

    async findOpenDealByPhone(telefoneNorm) {
      const target = phoneKey(telefoneNorm);
      if (!target) return null;
      const { data, error } = await db
        .from(TABLES.deals)
        .select("id, telefone")
        .not("stage", "in", "(fechado,perdido)")
        .is("deleted_at", null) // Lixeira: negócio apagado não conta como "já existe lead aberto"
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`procurar negócio: ${error.message}`);
      return data?.find((d) => d.telefone && phoneKey(d.telefone) === target)?.id ?? null;
    },

    async createDeal({ conversationId, assignedSellerId, nome, telefone, origem, destino, dataMudancaIso }) {
      // Lê o responsável DE NOVO agora (ele pode ter sido trocado nos segundos desde que a IA começou).
      let sellerId = assignedSellerId;
      const { data: current } = await db.from("crm_conversations").select("assigned_seller_id").eq("id", conversationId).maybeSingle();
      if (current) sellerId = (current.assigned_seller_id as string | null) ?? null;
      if (!sellerId) {
        // Lead novo do WhatsApp fica com o Head (só ele distribui); vai para o vendedor junto com a conversa.
        const { data: head } = await db
          .from(TABLES.profiles)
          .select("id")
          .eq("role", "head")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        sellerId = head?.id ?? null;
      }
      if (!sellerId) throw new Error("nenhum Head cadastrado para receber o negócio");

      const { data, error } = await db
        .from(TABLES.deals)
        .insert({
          seller_id: sellerId,
          nome,
          telefone,
          origem,
          destino,
          data_mudanca: dataMudancaIso,
          tipo_servico: null, // a definir pelo humano
          valor: 0, // a definir pelo humano
          stage: "lead_novo",
          parceiro: "",
        })
        .select("id")
        .single();
      if (error) throw new Error(`criar negócio: ${error.message}`);
      return data.id as string;
    },

    async linkDeal(conversationId, dealId) {
      const { error } = await db.from("crm_conversations").update({ deal_id: dealId }).eq("id", conversationId);
      if (error) throw new Error(`ligar negócio: ${error.message}`);
    },

    async syncDealOwner(conversationId) {
      await syncLinkedDealOwner(db, conversationId);
    },

    async fillDealGaps(dealId, data) {
      const { data: deal, error } = await db.from(TABLES.deals).select("origem, destino, data_mudanca").eq("id", dealId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error(`ler negócio: ${error.message}`);
      if (!deal) return;
      const patch: Record<string, string> = {};
      if (data.dataMudancaIso && !deal.data_mudanca) patch.data_mudanca = data.dataMudancaIso;
      if (data.origem && !String(deal.origem ?? "").trim()) patch.origem = data.origem;
      if (data.destino && !String(deal.destino ?? "").trim()) patch.destino = data.destino;
      if (Object.keys(patch).length === 0) return;
      const { error: updateError } = await db.from(TABLES.deals).update(patch).eq("id", dealId);
      if (updateError) throw new Error(`completar negócio: ${updateError.message}`);
    },

    async pickNextSeller() {
      // Só entram no revezamento as pessoas da lista fixa (SDR_SELLER_POOL), na ordem dela.
      // Podem ser vendedores ou o Head (ex.: o Head cobre um vendedor de férias).
      // Sem lista: ninguém é escolhido e o lead fica com o Head, que distribui à mão.
      const pool = options.sellerPoolIds ?? [];
      if (pool.length === 0) return null;
      const { data: sellers, error } = await db.from(TABLES.profiles).select("id").in("role", ["vendedor", "head"]).in("id", pool);
      if (error) throw new Error(`listar vendedores: ${error.message}`);
      const valid = new Set((sellers ?? []).map((row) => row.id as string));
      const ids = pool.filter((id) => valid.has(id));
      if (ids.length <= 1) return ids[0] ?? null;

      // Último vendedor da lista que recebeu um lead do WhatsApp (negócio ligado a uma conversa): o próximo é a vez.
      // Negócios na Lixeira CONTAM de propósito: o lead foi distribuído, então a vez segue para o próximo.
      const { data: convs, error: convError } = await db
        .from("crm_conversations")
        .select("deal_id")
        .not("deal_id", "is", null)
        .in("assigned_seller_id", ids)
        .limit(200);
      if (convError) throw new Error(`buscar conversas com negócio: ${convError.message}`);
      const dealIds = (convs ?? []).map((row) => row.deal_id as string);

      let lastSeller: string | null = null;
      if (dealIds.length > 0) {
        const { data: deals, error: dealError } = await db
          .from(TABLES.deals)
          .select("seller_id")
          .in("id", dealIds)
          .in("seller_id", ids)
          .order("created_at", { ascending: false })
          .limit(1);
        if (dealError) throw new Error(`buscar último negócio: ${dealError.message}`);
        lastSeller = (deals?.[0]?.seller_id as string | undefined) ?? null;
      }
      const index = lastSeller ? ids.indexOf(lastSeller) : -1;
      return ids[(index + 1) % ids.length];
    },

    async assignConversation(conversationId, sellerId) {
      // Só se ainda estiver sem dono (se o Head escolheu alguém nesse meio tempo, vale a escolha dele).
      const { error } = await db
        .from("crm_conversations")
        .update({ assigned_seller_id: sellerId })
        .eq("id", conversationId)
        .is("assigned_seller_id", null);
      if (error) throw new Error(`atribuir conversa ao vendedor: ${error.message}`);
    },

    async countAiMessagesSince(iso) {
      const { count, error } = await db
        .from("crm_messages")
        .select("id", { count: "exact", head: true })
        .eq("sender", "ai")
        .gte("created_at", iso);
      if (error) throw new Error(`contar mensagens da IA: ${error.message}`);
      return count ?? 0;
    },
  };
}

export function createSdrConfigStore(db: SupabaseClient): SdrConfigStore {
  return {
    async updateConfig({ aiEnabled, mode, updatedBy }) {
      const changes: Record<string, unknown> = { updated_by: updatedBy };
      if (aiEnabled !== undefined) changes.ai_enabled = aiEnabled;
      if (mode !== undefined) changes.mode = mode;
      const { error } = await db.from("crm_sdr_config").update(changes).eq("id", 1);
      if (error) throw new Error(`atualizar config da IA: ${error.message}`);
    },
  };
}

export function createSdrConversationStore(db: SupabaseClient): SdrConversationStore {
  return {
    async getAccess(conversationId) {
      const { data, error } = await db.from("crm_conversations").select("id, assigned_seller_id").eq("id", conversationId).maybeSingle();
      if (error) throw new Error(`buscar conversa: ${error.message}`);
      return data;
    },
    async setConversationAi(conversationId, enabled) {
      const { error } = await db
        .from("crm_conversations")
        .update({ ai_enabled: enabled, status: enabled ? "ai" : "human" })
        .eq("id", conversationId);
      if (error) throw new Error(`atualizar IA da conversa: ${error.message}`);
    },
  };
}

export function createMediaStore(db: SupabaseClient): MediaStore {
  return {
    async getMessage(messageId) {
      const { data, error } = await db.from("crm_messages").select("conversation_id, type, payload").eq("id", messageId).maybeSingle();
      if (error) throw new Error(`buscar mensagem: ${error.message}`);
      return data;
    },
    async getConversationAccess(conversationId) {
      const { data, error } = await db.from("crm_conversations").select("assigned_seller_id").eq("id", conversationId).maybeSingle();
      if (error) throw new Error(`buscar conversa: ${error.message}`);
      return data;
    },
  };
}

export function createPropostaStore(db: SupabaseClient): PropostaStore {
  return {
    async getDealAccess(dealId) {
      const { data, error } = await db.from(TABLES.deals).select("id, seller_id, stage, nome").eq("id", dealId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error(`buscar negócio: ${error.message}`);
      return data;
    },

    async getConversationByDeal(dealId) {
      const { data, error } = await db
        .from("crm_conversations")
        .select("id, wa_id, telefone_norm, assigned_seller_id, last_inbound_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`buscar conversa do negócio: ${error.message}`);
      return data;
    },

    async markProposalSent(dealId) {
      // Só avança quem ainda está no começo do funil (nunca volta nem mexe em negócio mais adiantado).
      const { error } = await db
        .from(TABLES.deals)
        .update({ stage: "orcamento_enviado" })
        .eq("id", dealId)
        .is("deleted_at", null)
        .in("stage", ["lead_novo", "qualificacao"]);
      if (error) throw new Error(`atualizar etapa: ${error.message}`);
    },
  };
}

/** Procura a conversa do VENDEDOR com o número da empresa (para saber se a janela de 24h dele está aberta). */
export function createNotifyStore(db: SupabaseClient) {
  return {
    async findSellerConversation(key: string) {
      const { data, error } = await db
        .from("crm_conversations")
        .select("wa_id, telefone_norm, last_inbound_at")
        .eq("telefone_norm", key)
        .maybeSingle();
      if (error) throw new Error(`buscar conversa do vendedor: ${error.message}`);
      if (!data) return null;
      return {
        waId: data.wa_id as string,
        telefoneNorm: (data.telefone_norm as string | null) ?? null,
        lastInboundAt: (data.last_inbound_at as string | null) ?? null,
      };
    },
  };
}
