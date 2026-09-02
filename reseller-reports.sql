-- ============================================================
-- PAMUSIKA — Update: a business reselling for another registered
-- business (e.g. Samah Valley selling on behalf of Munonwa) can link
-- one of its own categories to that business, then "Send" that
-- category's weekly figures straight into the other business's own
-- report — instead of folding it into its own report (see the
-- "Include in shared report" checklist added earlier).
--
-- The sent figures land as their OWN tagged rows on the receiving
-- business's side (distinguishable — who it came from, which
-- category), while also being added into that business's own weekly
-- total, so their report still reads as one combined number.
--
-- Nothing here touches the receiving business's own `sales` rows,
-- stock, or per-product figures — Samah Valley's products aren't the
-- same rows as Munonwa's, so this is reported totals only, not a
-- merge of the underlying sale records.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- Same wide-open RLS posture as the rest of the shop tables.
-- ============================================================

-- Which category maps to which business, for a given business.
create table if not exists category_business_links (
  business_id        integer not null references businesses(id),
  category           text not null,
  target_business_id integer not null references businesses(id),
  updated_at         timestamptz not null default now(),
  primary key (business_id, category)
);
alter table category_business_links enable row level security;
drop policy if exists category_business_links_rw on category_business_links;
create policy category_business_links_rw on category_business_links for all using (true) with check (true);

-- One row per (receiving business, sender, category, week) — sending again
-- for the same week updates the same row rather than duplicating it.
create table if not exists received_reseller_reports (
  id                     uuid primary key default gen_random_uuid(),
  receiving_business_id  integer not null references businesses(id),
  from_business_id       integer not null references businesses(id),
  from_business_name     text not null,
  category               text not null,
  week_start             date not null,
  week_end               date not null,
  total_sales            numeric(12,2) not null default 0,
  total_tithe            numeric(12,2) not null default 0,
  created_at             timestamptz not null default now(),
  unique (receiving_business_id, from_business_id, category, week_start)
);
alter table received_reseller_reports enable row level security;
drop policy if exists received_reseller_reports_rw on received_reseller_reports;
create policy received_reseller_reports_rw on received_reseller_reports for all using (true) with check (true);
