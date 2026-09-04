-- ============================================================
-- LUSTAVIRA — remove duplicate products (same name), keeping only
-- the most recently added copy of each. business_id = 26.
-- Run ONCE in Supabase → SQL Editor.
-- ============================================================

-- Preview first — see exactly what would be removed before it runs.
select name, count(*) as copies
from products
where business_id = 26
group by name
having count(*) > 1;

-- Then run this to actually remove the extras (keeps the newest id per name).
delete from products p
using products p2
where p.business_id = 26 and p2.business_id = 26
  and p.name = p2.name
  and p.id < p2.id;
