-- ============================================================
-- LUSTAVIRA — product catalog seed, from the price list you sent.
-- business_id = 26 (Lustavira). Run ONCE in Supabase → SQL Editor.
-- Stock quantities are set to 0 — enter real counts in the app after.
-- See the chat for what was skipped/split and why.
-- ============================================================

insert into categories (business_id, name) values
  (26, 'Detergents'), (26, 'Mhandire'), (26, 'Water'), (26, 'Airtime')
on conflict do nothing;

insert into products (business_id, name, price, category, pack_size, qty) values
  (26, 'Dishwash 5L (Wholesale)',              8.00, 'Detergents', 1, 0),
  (26, 'Dishwash 5L (Retail)',                 9.50, 'Detergents', 1, 0),
  (26, 'Dishwash 500ml (Wholesale)',           0.80, 'Detergents', 1, 0),
  (26, 'Dishwash 500ml (Retail)',              1.00, 'Detergents', 1, 0),
  (26, 'Dishwash 750ml (Retail)',              1.50, 'Detergents', 1, 0),
  (26, 'Floor/Toilet Cleaner (Wholesale)',     8.00, 'Detergents', 1, 0),
  (26, 'Floor/Toilet Cleaner (Retail)',        9.50, 'Detergents', 1, 0),
  (26, 'Pinegel 500ml (Retail)',               2.50, 'Detergents', 1, 0),
  (26, 'Pinegel 1L (Retail)',                  4.00, 'Detergents', 1, 0),
  (26, 'Mhandire (pack of 8)',                 1.00, 'Mhandire',   8, 0),
  (26, 'Water (6 pack)',                       2.40, 'Water',      6, 0),
  (26, 'Airtime',                              0.92, 'Airtime',    1, 0);
