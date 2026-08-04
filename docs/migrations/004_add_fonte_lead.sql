-- =========================================================
-- Migração 004: adicionar fonte_lead em deals
-- =========================================================
-- Cola no SQL Editor do Supabase e roda uma vez.
-- Idempotente: pode rodar de novo sem quebrar nada.
--
-- "De onde veio o lead" — preenchido no modal de editar deal
-- quando a etapa é "fechado".
-- =========================================================

alter table public.deals
  add column if not exists fonte_lead text
  check (fonte_lead in ('google','redes_sociais','indicacao','empresa','ja_era_cliente'));
