-- Run ONLY this one, on its own — which business_id is the early-August
-- sale actually filed under?
select business_id, invoice_no, seller_name, sold_at, total
from sales
where business_id in (select id from businesses where name = 'Samah Valley')
  and sold_at >= '2026-08-01' and sold_at < '2026-08-16'
order by sold_at;
