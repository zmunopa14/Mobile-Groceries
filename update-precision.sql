-- ============================================================
-- PAMUSIKA — Update: allow prices with more decimal places
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- Safe: existing prices are kept, just stored with more precision.
-- ============================================================

-- Was numeric(12,2) which rounded to 2 decimals (0.475 -> 0.48).
-- numeric with no scale keeps whatever precision you enter.
alter table products
  alter column price type numeric using price::numeric;
