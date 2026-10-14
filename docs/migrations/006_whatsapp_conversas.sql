-- =========================================================
-- 006 — WhatsApp: conversas, mensagens e config da IA (Carol)
-- ⚠️ Só CRIA 3 tabelas novas (crm_conversations, crm_messages, crm_sdr_config).
--    Não altera nenhuma tabela/política existente (deals, profiles, processos,
--    contas_pagar, frota, guarda-móveis etc. ficam intactas).
--    Só CHAMA as funções que já existem: is_head() e set_updated_at().
-- =========================================================


-- ---------------------------------------------------------
-- CRM_CONVERSATIONS: uma linha por pessoa que fala com a Amitran no WhatsApp
-- ---------------------------------------------------------
create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,            -- número no formato da Meta (só dígitos, ex.: 5531...)
  telefone_norm text not null,           -- número normalizado, para ligar com deals.telefone
  contact_name text default '',          -- nome que a pessoa usa no WhatsApp
  deal_id uuid references public.deals(id) on delete set null,          -- negócio ligado (opcional, explícito)
  assigned_seller_id uuid references auth.users(id) on delete set null, -- NULL = sem dono (só o Head vê)
  status text not null default 'human' check (status in ('ai','human','paused')), -- quem atende agora
  ai_enabled boolean not null default false,  -- interruptor da IA só nesta conversa
  last_inbound_at timestamptz,           -- última msg DO CLIENTE (janela de 24h do WhatsApp)
  last_message_at timestamptz,           -- última msg de qualquer lado (ordenar a lista)
  qualification jsonb not null default '{}'::jsonb,  -- o que a IA já descobriu do lead
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_conversations_seller   on public.crm_conversations(assigned_seller_id);
create index if not exists idx_crm_conversations_last_msg on public.crm_conversations(last_message_at desc);
create index if not exists idx_crm_conversations_deal     on public.crm_conversations(deal_id);

drop trigger if exists crm_conversations_set_updated_at on public.crm_conversations;
create trigger crm_conversations_set_updated_at
  before update on public.crm_conversations
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------
-- CRM_MESSAGES: cada mensagem (do cliente, da IA ou de humano)
-- ---------------------------------------------------------
create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender text not null check (sender in ('contact','ai','human','system')),
  sender_user_id uuid references auth.users(id) on delete set null,  -- qual humano mandou (se aplicável)
  type text not null default 'text',     -- text, image, audio... (sem trava de propósito: nunca perder msg)
  content text,                          -- texto da mensagem (ou legenda)
  payload jsonb not null default '{}'::jsonb,  -- JSON cru da Meta, para auditoria/mídia
  whatsapp_message_id text unique,       -- ID da Meta: garante que nunca grava a mesma msg 2x
  status text not null check (status in ('received','draft','queued','sent','delivered','read','failed')),
  error text,                            -- motivo, se falhou ou foi bloqueada
  wa_timestamp timestamptz,              -- horário que a Meta informou
  processed_at timestamptz,              -- quando a IA/worker já tratou (fila assíncrona)
  created_at timestamptz not null default now(),
  -- cliente só envia "inbound"; IA/humano/sistema só "outbound"
  check ((direction = 'inbound'  and sender = 'contact')
      or (direction = 'outbound' and sender <> 'contact'))
);

create index if not exists idx_crm_messages_conv_created
  on public.crm_messages(conversation_id, created_at);

-- Fila da IA: só as mensagens do cliente ainda não processadas
create index if not exists idx_crm_messages_pending
  on public.crm_messages(created_at)
  where direction = 'inbound' and processed_at is null;


-- ---------------------------------------------------------
-- CRM_SDR_CONFIG: configuração global da IA (SEMPRE 1 linha só)
-- ---------------------------------------------------------
create table if not exists public.crm_sdr_config (
  id int primary key default 1 check (id = 1),   -- trava: impossível existir 2ª linha
  ai_enabled boolean not null default false,     -- KILL SWITCH GLOBAL (começa DESLIGADO)
  mode text not null default 'shadow' check (mode in ('shadow','auto')), -- começa em modo sombra
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.crm_sdr_config (id) values (1) on conflict (id) do nothing;

drop trigger if exists crm_sdr_config_set_updated_at on public.crm_sdr_config;
create trigger crm_sdr_config_set_updated_at
  before update on public.crm_sdr_config
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------
-- SEGURANÇA — RLS: o navegador só LÊ; só o backend escreve
-- ---------------------------------------------------------
alter table public.crm_conversations enable row level security;
alter table public.crm_messages      enable row level security;
alter table public.crm_sdr_config    enable row level security;

-- Cinto + suspensório: tira do navegador qualquer permissão de escrita
-- (e do anônimo, qualquer acesso). O service_role do backend não é afetado.
revoke all on public.crm_conversations, public.crm_messages, public.crm_sdr_config
  from anon, authenticated;
grant select on public.crm_conversations, public.crm_messages, public.crm_sdr_config
  to authenticated;

-- Conversas: vendedor vê só as dele; Head vê todas (inclusive sem dono)
drop policy if exists "crm_conversations_select" on public.crm_conversations;
create policy "crm_conversations_select" on public.crm_conversations
  for select using (assigned_seller_id = (select auth.uid()) or public.is_head());

-- Mensagens: só de conversas que o usuário pode ver
drop policy if exists "crm_messages_select" on public.crm_messages;
create policy "crm_messages_select" on public.crm_messages
  for select using (
    public.is_head() or exists (
      select 1 from public.crm_conversations c
      where c.id = crm_messages.conversation_id
        and c.assigned_seller_id = (select auth.uid())
    )
  );

-- Config da IA: só o Head enxerga
drop policy if exists "crm_sdr_config_select" on public.crm_sdr_config;
create policy "crm_sdr_config_select" on public.crm_sdr_config
  for select using (public.is_head());

-- (propositalmente NÃO há políticas de INSERT/UPDATE/DELETE em nenhuma das 3)
