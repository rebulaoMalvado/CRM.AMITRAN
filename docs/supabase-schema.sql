-- =========================================================
-- NOG CRM — Schema inicial do Supabase
-- =========================================================
-- Como rodar:
-- 1. No painel do Supabase → SQL Editor → New query
-- 2. Cole este arquivo inteiro e clique em "Run"
-- 3. Vá em Authentication → Providers → Email e DESLIGUE
--    "Confirm email" (assim vendedor criado pelo admin já
--    pode logar direto, sem precisar confirmar email)
-- 4. Crie seu usuário (head) em Authentication → Users →
--    Add user → informe seu email + senha
-- 5. Rode a última query deste arquivo (PROMOVER PARA HEAD)
--    trocando 'SEU_EMAIL_AQUI@exemplo.com' pelo seu email
-- =========================================================

-- ---------------------------------------------------------
-- PROFILES: dados extras do usuário (role, nome)
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'vendedor' check (role in ('vendedor', 'head')),
  created_at timestamptz default now()
);

-- Auto-criar profile quando novo auth.user é criado
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'vendedor')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- DEALS: leads do CRM com dono (seller_id)
-- ---------------------------------------------------------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users on delete cascade,
  nome text not null,
  telefone text default '',
  origem text default '',
  destino text default '',
  data_mudanca date,
  tipo_servico text check (tipo_servico in ('economico', 'completo')),
  valor numeric default 0,
  stage text not null check (stage in ('lead_novo','qualificacao','orcamento_enviado','negociacao','fechado','perdido')),
  parceiro text default '',
  motivo_perda text check (motivo_perda in ('preco','concorrencia','desistiu','sem_resposta','outro')),
  closed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_deals_seller_id on public.deals(seller_id);
create index if not exists idx_deals_created_at on public.deals(created_at desc);
create index if not exists idx_deals_closed_at on public.deals(closed_at);

-- Trigger pra atualizar updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- Preenche closed_at quando stage vira fechado/perdido; limpa se voltar atrás
create or replace function public.set_closed_at()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.stage in ('fechado', 'perdido') then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  elsif tg_op = 'UPDATE' then
    if new.stage in ('fechado', 'perdido')
       and (old.stage is distinct from new.stage)
       and old.stage not in ('fechado', 'perdido') then
      new.closed_at := now();
    elsif new.stage not in ('fechado', 'perdido')
          and old.stage in ('fechado', 'perdido') then
      new.closed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_set_closed_at on public.deals;
create trigger deals_set_closed_at
  before insert or update on public.deals
  for each row execute function public.set_closed_at();

-- ---------------------------------------------------------
-- Função helper: usuário atual é head?
-- Usa security definer pra evitar recursão com RLS de profiles
-- ---------------------------------------------------------
create or replace function public.is_head()
returns boolean
language sql
security definer set search_path = public
stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'head'
  );
$$;

-- ---------------------------------------------------------
-- RLS (Row-Level Security)
-- ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.deals enable row level security;

-- ---- PROFILES ----
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_head());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_update_head" on public.profiles;
create policy "profiles_update_head" on public.profiles
  for update using (public.is_head()) with check (public.is_head());

-- ---- DEALS ----
drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (seller_id = auth.uid() or public.is_head());

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (seller_id = auth.uid() or public.is_head());

drop policy if exists "deals_update" on public.deals;
create policy "deals_update" on public.deals
  for update using (seller_id = auth.uid() or public.is_head())
  with check (seller_id = auth.uid() or public.is_head());

drop policy if exists "deals_delete" on public.deals;
create policy "deals_delete" on public.deals
  for delete using (seller_id = auth.uid() or public.is_head());

-- ---------------------------------------------------------
-- PROSPECTS: carteira de tomadores de decisão por vendedor
-- ---------------------------------------------------------
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users on delete cascade,
  empresa text not null,
  contato_nome text default '',
  telefone text default '',
  email text default '',
  status text not null default 'frio' check (status in ('frio', 'morno', 'quente')),
  ultimo_contato date,
  proximo_contato date,
  observacoes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_prospects_seller_id on public.prospects(seller_id);
create index if not exists idx_prospects_proximo_contato on public.prospects(proximo_contato);

drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

alter table public.prospects enable row level security;

drop policy if exists "prospects_select" on public.prospects;
create policy "prospects_select" on public.prospects
  for select using (seller_id = auth.uid() or public.is_head());

drop policy if exists "prospects_insert" on public.prospects;
create policy "prospects_insert" on public.prospects
  for insert with check (seller_id = auth.uid() or public.is_head());

drop policy if exists "prospects_update" on public.prospects;
create policy "prospects_update" on public.prospects
  for update using (seller_id = auth.uid() or public.is_head())
  with check (seller_id = auth.uid() or public.is_head());

drop policy if exists "prospects_delete" on public.prospects;
create policy "prospects_delete" on public.prospects
  for delete using (seller_id = auth.uid() or public.is_head());

-- =========================================================
-- PROMOVER SEU USUÁRIO PRA HEAD
-- (rode essa query DEPOIS de criar seu usuário em
--  Authentication → Users → Add user)
-- Troque o email pelo seu:
-- =========================================================
--
-- update public.profiles
--   set role = 'head', name = 'Seu Nome'
--   where id = (select id from auth.users where email = 'SEU_EMAIL_AQUI@exemplo.com');
--
