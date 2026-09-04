-- ============================================================
-- LUSTAVIRA — corrections. business_id = 26. Run ONCE in Supabase.
--  1. Split the wrongly-merged "Floor/Toilet Cleaner" into the two
--     real separate products shown on the actual invoice.
--  2. Remove category grouping entirely — each product just keeps
--     its own price and its own tithe_pct directly (no categories
--     needed for this project right now). Existing tithe_pct values
--     already set per category are left exactly as they are.
-- ============================================================

delete from products where business_id = 26 and name in
  ('Floor/Toilet Cleaner (Wholesale)', 'Floor/Toilet Cleaner (Retail)');

insert into products (business_id, name, price, tithe_pct, qty) values
  (26, 'Floor Cleaner (Wholesale)',   8.00, 8, 0),
  (26, 'Floor Cleaner (Retail)',      9.50, 8, 0),
  (26, 'Toilet Cleaner (Wholesale)',  8.00, 8, 0),
  (26, 'Toilet Cleaner (Retail)',     9.50, 8, 0);

update products set category = '' where business_id = 26;
delete from categories where business_id = 26;
