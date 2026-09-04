-- ============================================================
-- LUSTAVIRA — completely clear sales data. business_id = 26.
-- Deletes ALL sales AND all cash-up ("Close day") submissions for
-- Lustavira, for a clean slate. Products/stock are NOT touched —
-- only transactional history. This cannot be undone.
-- Run ONCE in Supabase → SQL Editor.
-- ============================================================

delete from sales where business_id = 26;
delete from day_reports where business_id = 26;
