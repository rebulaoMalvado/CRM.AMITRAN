-- =========================================================
-- Migração 001: adicionar closed_at em deals
-- =========================================================
-- Cola no SQL Editor do Supabase e roda uma vez.
-- Idempotente: pode rodar de novo sem quebrar nada.
-- =========================================================

-- 1) Coluna nova
alter table public.deals
  add column if not exists closed_at timestamptz;

-- 2) Backfill: pra deals que já estão fechado/perdido,
--    usa updated_at como proxy (melhor que nada)
update public.deals
  set closed_at = updated_at
  where stage in ('fechado', 'perdido') and closed_at is null;

-- 3) Trigger: preenche/limpa closed_at ao mudar stage
create or replace function public.set_closed_at()
returns trigger
language plpgsql
as $$
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

-- 4) Index pra relatórios por mês
create index if not exists idx_deals_closed_at on public.deals(closed_at);
