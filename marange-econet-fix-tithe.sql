-- ============================================================
-- PAMUSIKA — Marange Econet (business id 32): the products/sales
-- were already inserted at 0% To God before the 3% instruction came
-- in. This brings both up to 3% without re-running the whole insert.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

update products
set tithe_pct = 3
where business_id = 32;

update sales
set tithe = round(total * 0.03, 2)
where business_id = 32
  and product_id is not null;
