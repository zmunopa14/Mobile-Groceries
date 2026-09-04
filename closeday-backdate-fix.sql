-- ============================================================
-- PAMUSIKA — Update: fix "Close day" undercounting new sales when
-- they're backdated. It used to track "new since last cash-up" by
-- comparing a sale's date against the TIME the last cash-up was
-- submitted — but a backdated sale's date can be earlier than that
-- submission time even though it was just added, so it silently
-- didn't count. Now the exact sales included in each cash-up are
-- recorded, so a new cash-up for the same day only excludes sales
-- that were genuinely already reported, regardless of dates.
-- Existing (older) cash-ups have no record of which sales they
-- covered, so they keep working exactly as before (time-cutoff) —
-- this only changes behavior for cash-ups submitted after this runs.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

alter table day_reports add column if not exists sale_ids jsonb;
