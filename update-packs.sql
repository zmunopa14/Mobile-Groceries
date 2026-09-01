-- ============================================================
-- STOCKFLOW — Update: pack sizes
-- Run this once in Supabase → SQL Editor → New query → paste → Run
-- Safe to run on your existing database; it only adds a column.
-- ============================================================

-- Each product now has a pack size (how many units in one carton/pack).
-- Stock (qty) is still counted in UNITS. A pack of 20 with 5 cartons = 100 units.
alter table products
  add column if not exists pack_size integer not null default 1;
