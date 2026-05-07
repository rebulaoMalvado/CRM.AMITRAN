-- =========================================================
-- Migração 003: tabela deal_installments (parcelas de pagamento)
-- =========================================================
-- Cola no SQL Editor do Supabase e roda. Idempotente.
-- Parcelas existem apenas pra deals com stage = 'fechado',
-- mas a tabela permite parcelas em qualquer deal (regra é da UI).
-- Colunas is_received / received_date / received_amount são
-- usadas no PR 2 (marcação de recebimento) — já criadas aqui.
-- =========================================================

create table if not exists public.deal_installments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  installment_number int not null check (installment_number >= 1),
  amount numeric not null default 0,
  due_date date not null,
  is_received boolean not null default false,
  received_date date,
  received_amount numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deal_installments_deal_id
  on public.deal_installments(deal_id);

create index if not exists idx_deal_installments_deal_id_number
  on public.deal_installments(deal_id, installment_number);

-- Reusa o trigger set_updated_at já existente (criado no schema base)
drop trigger if exists deal_installments_set_updated_at on public.deal_installments;
create trigger deal_installments_set_updated_at
  before update on public.deal_installments
  for each row execute function public.set_updated_at();

-- RLS — mesmo padrão dos deals: vendedor vê/edita parcelas dos
-- próprios deals, head vê/edita tudo. Validação via subquery em deals.
alter table public.deal_installments enable row level security;

drop policy if exists "deal_installments_select" on public.deal_installments;
create policy "deal_installments_select" on public.deal_installments
  for select using (
    public.is_head() or exists (
      select 1 from public.deals d
      where d.id = deal_installments.deal_id and d.seller_id = auth.uid()
    )
  );

drop policy if exists "deal_installments_insert" on public.deal_installments;
create policy "deal_installments_insert" on public.deal_installments
  for insert with check (
    public.is_head() or exists (
      select 1 from public.deals d
      where d.id = deal_installments.deal_id and d.seller_id = auth.uid()
    )
  );

drop policy if exists "deal_installments_update" on public.deal_installments;
create policy "deal_installments_update" on public.deal_installments
  for update using (
    public.is_head() or exists (
      select 1 from public.deals d
      where d.id = deal_installments.deal_id and d.seller_id = auth.uid()
    )
  ) with check (
    public.is_head() or exists (
      select 1 from public.deals d
      where d.id = deal_installments.deal_id and d.seller_id = auth.uid()
    )
  );

drop policy if exists "deal_installments_delete" on public.deal_installments;
create policy "deal_installments_delete" on public.deal_installments
  for delete using (
    public.is_head() or exists (
      select 1 from public.deals d
      where d.id = deal_installments.deal_id and d.seller_id = auth.uid()
    )
  );
