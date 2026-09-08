-- ============================================================
-- FIX — this one actually changes data. Review before running.
--
-- Keeps INV-396BAA as the one real sale (Boom Paste, Fruita YESS,
-- Gloria Munchies, Large snax, Pascal 20 units x0.5, Rosy, Samah
-- Peanut butter — $41.00, sold by Gamu), corrects its date to
-- Thursday 3 August 2026, and deletes the three duplicate copies
-- that were re-entered on 3 Sept and twice on 8 Sept.
-- ============================================================

delete from sales
where invoice_no in ('INV-262CB7', 'INV-2C45C8', 'INV-5580AF');

update sales
set sold_at = '2026-08-03 14:10:00+00'
where invoice_no = 'INV-396BAA';
