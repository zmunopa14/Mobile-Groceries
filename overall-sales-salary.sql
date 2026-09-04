-- ============================================================
-- PAMUSIKA — Update: a salary that's simply "X% of total sales",
-- with no category needed — for a business with no categories set
-- up (or where the salary just isn't tied to one specific company).
-- Separate from the per-category salary % and the outside-job salary,
-- with its own independent "to God" percentage, same pattern as both
-- of those.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

alter table business_salary_settings add column if not exists sales_salary_pct numeric(5,2) not null default 0;
alter table business_salary_settings add column if not exists sales_salary_tithe_pct numeric(5,2) not null default 10;
