-- ============================================================
-- PAMUSIKA — Turn off Munopa's paywall exemption on Samah Valley
-- specifically (business id 1 only — this does NOT touch the Munonwa
-- platform-owner exemption, which stays on). Samah Valley pays
-- normally now, so this account should see the same $2/week prompt
-- as everyone else once paid_until passes.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

update members
set exempt = false
where name = 'Munopa'
  and business_id = 1;
