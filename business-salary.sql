-- ============================================================
-- PAMUSIKA — Update: a salary section on the Tuesday report.
-- Two separate sources feed it, both entered by the business owner:
--  1. A percentage of EACH company/category's sales for the week —
--     someone selling for several companies under one business can
--     draw a different percentage from each one, not one combined rate.
--  2. A fixed salary from their own job elsewhere (unrelated to the
--     shop), with its own "to God" percentage they set themselves
--     (products already have their own tithe_pct for sales — this is
--     a separate, independent percentage just for this outside salary).
-- Business-wide (not per seller) — this is the owner's own income
-- tracking, not a payroll feature for staff.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- Same wide-open RLS posture as the rest of the shop tables.
-- ============================================================

-- One row per business: the outside-job salary and its own tithe %.
create table if not exists business_salary_settings (
  business_id       integer primary key references businesses(id),
  outside_salary    numeric(12,2) not null default 0,
  outside_tithe_pct numeric(5,2) not null default 10,
  updated_at        timestamptz not null default now()
);

-- One row per (business, category): that category's own salary percentage,
-- plus its own "to God" percentage taken from the resulting salary amount
-- (separate from the tithe already charged per-sale via products.tithe_pct
-- — this one applies to the salary figure itself, after it's computed).
create table if not exists business_salary_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  integer not null references businesses(id),
  category     text not null,
  pct          numeric(5,2) not null default 0,
  tithe_pct    numeric(5,2) not null default 10,
  updated_at   timestamptz not null default now(),
  unique (business_id, category)
);
alter table business_salary_categories add column if not exists tithe_pct numeric(5,2) not null default 10;

alter table business_salary_settings enable row level security;
drop policy if exists business_salary_settings_rw on business_salary_settings;
create policy business_salary_settings_rw on business_salary_settings for all using (true) with check (true);

alter table business_salary_categories enable row level security;
drop policy if exists business_salary_categories_rw on business_salary_categories;
create policy business_salary_categories_rw on business_salary_categories for all using (true) with check (true);
