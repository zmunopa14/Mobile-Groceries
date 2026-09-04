-- ============================================================
-- SAMAH VALLEY — find and fix the two sales that got mis-dated to
-- "today" instead of 24 Aug 2026 ($10) and 26 Aug 2026 ($92.50).
-- Run the SELECT first, alone, and check the results before running
-- either UPDATE.
-- ============================================================

-- 1. Look at recent sales for Samah Valley, grouped by invoice, so you
--    can spot the $10 one and the $92.50 one and note their invoice_no
--    (or id, if invoice_no is blank for a single-line sale / catch-up entry).
select invoice_no, id, product_name, qty, total, sold_at
from sales
where business_id = 26 -- Lustavira
order by sold_at desc
limit 30;

-- 2. Once you've identified them, fill in the real invoice_no (or id) below
--    and run each UPDATE separately.

-- For the $10 sale → 24 Aug 2026:
-- update sales set sold_at = '2026-08-24 12:00:00'
-- where business_id = 26 -- Lustavira
--   and invoice_no = 'PUT_THE_INVOICE_NO_HERE';
-- (or, if it has no invoice_no: ... where id = 'PUT_THE_ID_HERE';)

-- For the $92.50 sale → 26 Aug 2026:
-- update sales set sold_at = '2026-08-26 12:00:00'
-- where business_id = 26 -- Lustavira
--   and invoice_no = 'PUT_THE_INVOICE_NO_HERE';
