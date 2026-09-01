-- ============================================================
-- PAMUSIKA — Update: day-end cash-up reports
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- ============================================================

create table if not exists day_reports (
  id            uuid primary key default gen_random_uuid(),
  business_id   integer not null,
  seller_name   text not null,
  report_date   date not null,
  sales_total   numeric not null default 0,
  cash_in_hand  numeric not null default 0,
  tx_count      integer not null default 0,
  note          text,
  confirmed     boolean not null default false,
  created_at    timestamptz default now()
);

alter table day_reports enable row level security;

drop policy if exists day_reports_read on day_reports;
create policy day_reports_read on day_reports for select using (true);

drop policy if exists day_reports_write on day_reports;
create policy day_reports_write on day_reports for all using (true) with check (true);
