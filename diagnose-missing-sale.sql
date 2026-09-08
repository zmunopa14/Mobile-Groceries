-- ============================================================
-- DIAGNOSTIC ONLY — no changes made. Run in Supabase → SQL Editor
-- and paste back the results.
--
-- All of Lustavira's sales from 20 Aug to 5 Sept 2026, newest first,
-- so we can see exactly what time is really stored for the one
-- that's dropping out of the 24–29 Aug report total.
-- ============================================================

select
  s.invoice_no,
  s.customer_name,
  s.product_name,
  s.qty,
  s.sold_at,                                  -- raw stored value (UTC instant)
  s.sold_at at time zone 'Africa/Harare' as sold_at_harare_time,
  s.total
from sales s
join businesses b on b.id = s.business_id
where b.name = 'Lustavira'
  and s.sold_at between '2026-08-20' and '2026-09-05'
order by s.sold_at desc;
