-- ============================================================
-- LUSTAVIRA — "To God" percentage per category. business_id = 26.
-- Run ONCE in Supabase → SQL Editor.
-- ============================================================

update products set tithe_pct = 8  where business_id = 26 and category = 'Detergents';
update products set tithe_pct = 10 where business_id = 26 and category = 'Water';
update products set tithe_pct = 10 where business_id = 26 and category = 'Mhandire';
update products set tithe_pct = 2  where business_id = 26 and category = 'Airtime';

-- Carrier didn't exist yet (its price varies by route, so it wasn't in the
-- earlier product seed) — added here as a placeholder at $0. Edit its
-- price in Stock to the actual route fee before each sale.
insert into categories (business_id, name) values (26, 'Carrier') on conflict do nothing;
insert into products (business_id, name, price, category, tithe_pct, qty) values
  (26, 'Carrier (edit price per route before selling)', 0, 'Carrier', 50, 0);
