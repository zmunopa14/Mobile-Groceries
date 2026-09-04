-- ============================================================
-- PAMUSIKA — Update: archive a product instead of only being able
-- to permanently delete it. A product with real sales history can
-- never be deleted (the database correctly refuses, to protect that
-- history) — archiving hides it from Stock and the selling screen
-- without touching any of its past sales or reports.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

alter table products add column if not exists archived boolean not null default false;
