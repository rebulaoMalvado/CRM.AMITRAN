-- =========================================================
-- Migração 002: tabela prospects (carteira de tomadores de decisão)
-- =========================================================
-- Cola no SQL Editor do Supabase e roda. Idempotente.
-- =========================================================

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

-- Reusa o trigger set_updated_at já existente (criado na schema base)
drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

-- RLS — mesmo padrão dos deals
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
