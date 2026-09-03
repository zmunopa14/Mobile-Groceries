-- ============================================================
-- PAMUSIKA — Update: a floating "you have new messages" button
-- visible from anywhere in the app, not just when you happen to open
-- Community — covers both the open room and direct messages.
-- Tracks, per business, when they last checked messages; anything
-- newer than that (from someone else) counts as unread.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

create table if not exists business_message_reads (
  business_id   integer primary key references businesses(id),
  last_read_at  timestamptz not null default now()
);

alter table business_message_reads enable row level security;
drop policy if exists business_message_reads_rw on business_message_reads;
create policy business_message_reads_rw on business_message_reads for all using (true) with check (true);
