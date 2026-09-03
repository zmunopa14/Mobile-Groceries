-- ============================================================
-- PAMUSIKA — Update: the platform-owner approvals (new business
-- registrations, weekly subscription payments) can now live as an
-- "Approvals" tab inside one specific business's own account
-- (e.g. Munonwa), instead of only through the separate standalone
-- "owner" login. The old owner login still works exactly as before —
-- this is additive, not a replacement.
--
-- When a payment is approved from inside that business's Approvals
-- tab, the amount is also credited to THAT business's own revenue,
-- tagged under a "Pamusika" category — so it flows through the same
-- per-category salary % / weekly report machinery as everything else
-- (reseller-reports.sql, business-salary.sql).
--
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Then run the UPDATE at the bottom yourself, adjusted to the actual
-- business/member you want to grant this to.
-- ============================================================

alter table members add column if not exists is_platform_owner boolean not null default false;

-- Subscription payments can now be submitted as cash, not just EcoCash —
-- still needs the same approval either way.
alter table payments add column if not exists method text not null default 'ecocash';

-- Uncomment and adjust, then run once — this grants the Approvals tab to
-- Munonwa's own admin account. Only one member needs this; it's a
-- capability flag on that specific login, not a business-wide setting.
-- update members set is_platform_owner = true
--   where business_id = (select id from businesses where name = 'Munonwa')
--     and role = 'admin';
