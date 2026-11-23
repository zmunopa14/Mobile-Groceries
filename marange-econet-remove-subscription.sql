-- ============================================================
-- PAMUSIKA — Free up Marange Econet (business id 32) right now and
-- take it off the subscription paywall entirely going forward.
--
-- The app's lock only triggers when paid_until is set AND has
-- passed — if paid_until is left blank (null), the business is
-- always treated as paid, for every login, with no need for an
-- "exempt" flag on any one person. Setting it to null here does both
-- things at once: unlocks it immediately, and removes the $2/week
-- requirement for good.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

update businesses
set paid_until = null
where id = 32;
