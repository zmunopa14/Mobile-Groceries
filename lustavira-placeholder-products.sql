-- ============================================================
-- LUSTAVIRA — add the remaining products with no price yet, as
-- placeholders at $0 so they exist in Stock and can be priced
-- whenever you get the real numbers. business_id = 26.
-- Run ONCE in Supabase → SQL Editor.
-- ============================================================

insert into products (business_id, name, price, tithe_pct, qty) values
  (26, 'Jik',                          0, 8, 0),
  (26, 'Degreaser',                    0, 8, 0),
  (26, 'Engine Cleaner',               0, 8, 0),
  (26, 'Bleach',                       0, 8, 0),
  (26, 'Dishwash 750ml (Wholesale)',   0, 8, 0);
