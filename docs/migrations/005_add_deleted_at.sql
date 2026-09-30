-- =========================================================
-- Migração 005: soft-delete (lixeira) em deals
-- =========================================================
-- Cola no SQL Editor do Supabase e roda uma vez.
-- Idempotente: pode rodar de novo sem quebrar nada.
--
-- Em vez de apagar de vez, o app passa a marcar deleted_at.
-- Deals com deleted_at preenchido ficam na "Lixeira" e podem
-- ser restaurados (deleted_at = null) ou excluídos de vez.
-- =========================================================

alter table public.deals
  add column if not exists deleted_at timestamptz;

-- Index parcial: acelera o filtro "não apagados" (o caso comum).
create index if not exists idx_deals_deleted_at
  on public.deals(deleted_at)
  where deleted_at is not null;
