-- ============================================================
-- PAMUSIKA — Update: which day of the week the report cycle starts
-- on is now settable per business, instead of always Tuesday. One row
-- per business; defaults to 2 (Tuesday) so nothing changes for anyone
-- who never touches this setting.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- Same wide-open RLS posture as the rest of the shop tables.
-- ============================================================

create table if not exists business_report_settings (
  business_id     integer primary key references businesses(id),
  week_start_day  integer not null default 2 check (week_start_day between 0 and 6), -- 0=Sun .. 6=Sat
  updated_at      timestamptz not null default now()
);

alter table business_report_settings enable row level security;
drop policy if exists business_report_settings_rw on business_report_settings;
create policy business_report_settings_rw on business_report_settings for all using (true) with check (true);
