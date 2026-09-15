-- ============================================================
-- PAMUSIKA — Fix: restore the paywall exemption on the real Munonwa
-- platform-owner account (found by is_platform_owner = true, since the
-- member name there is "Munopa Zinyama", not "Munopa").
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

update members
set exempt = true
where id = '1ceb3cfb-3bf3-4c93-b623-6f30adfe0c78';
