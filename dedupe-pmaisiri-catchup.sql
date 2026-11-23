-- ============================================================
-- PAMUSIKA — Removes the duplicate P Maisiri catch-up entries from
-- running add-pmaisiri-catchup.sql twice. Since every duplicate has
-- the exact same business_id + sold_at + total, this keeps only the
-- oldest (lowest id) copy of each and deletes the rest.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

delete from sales s
using (
  select id, row_number() over (partition by business_id, sold_at, total order by id) as rn
  from sales
  where business_id = 3 and product_id is null and product_name = 'Daily total catch-up'
) d
where s.id = d.id and d.rn > 1;
