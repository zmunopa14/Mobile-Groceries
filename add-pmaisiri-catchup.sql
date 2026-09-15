-- ============================================================
-- PAMUSIKA — Add P Maisiri's (Master Pee, business id 3) daily totals
-- as catch-up entries — no itemized products, just the true total he
-- calculated by hand each day, each stamped with a 3% "to God" rate.
-- Sunday 14 Sept is skipped (his day off).
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

select record_catchup_sale(3, 'P Maisiri', 135.25, 3, 'Daily total catch-up', '2026-09-08 18:00:00+00');
select record_catchup_sale(3, 'P Maisiri', 125.50, 3, 'Daily total catch-up', '2026-09-09 18:00:00+00');
select record_catchup_sale(3, 'P Maisiri', 142.25, 3, 'Daily total catch-up', '2026-09-10 18:00:00+00');
select record_catchup_sale(3, 'P Maisiri', 150.00, 3, 'Daily total catch-up', '2026-09-11 18:00:00+00');
select record_catchup_sale(3, 'P Maisiri', 141.00, 3, 'Daily total catch-up', '2026-09-12 18:00:00+00');
select record_catchup_sale(3, 'P Maisiri', 178.25, 3, 'Daily total catch-up', '2026-09-13 18:00:00+00');
