-- ============================================================
-- PAMUSIKA — Update: allow decimal quantities (e.g. 0.5 of a pack),
-- not just whole numbers. Both products.qty and sales.qty were
-- integer-only, so entering something like 0.5 packs failed with
-- "invalid input syntax for type integer" every time — silently
-- queuing the sale offline forever since the same bad number keeps
-- getting rejected on every retry.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

alter table products alter column qty type numeric using qty::numeric;
alter table sales    alter column qty type numeric using qty::numeric;

create or replace function record_invoice(p_items jsonb, p_seller text, p_customer text, p_phone text, p_sold_at timestamptz default null)
returns text
language plpgsql security definer as $$
declare
  item jsonb;
  prod products;
  q numeric;
  inv text;
  ts timestamptz := coalesce(p_sold_at, now());
begin
  inv := 'INV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'qty')::numeric;
    update products set qty = qty - q where id = prod.id;   -- may go negative on purpose
    insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no, customer_name, customer_phone, sold_at)
    values (prod.id, prod.name, p_seller, q, prod.price,
      prod.price * q, round(prod.price * q * prod.tithe_pct / 100, 2), prod.business_id, inv, p_customer, p_phone, ts);
  end loop;

  return inv;
end; $$;

-- The original single-item sale function (record_invoice replaced it in
-- practice, but fixing it too in case anything still calls it). Its
-- p_qty parameter type is changing (integer → numeric), so the old
-- signature has to be dropped first or both would exist as an overload.
drop function if exists record_sale(uuid, integer, text);
create or replace function record_sale(p_product_id uuid, p_qty numeric, p_seller text)
returns sales
language plpgsql
security definer
as $$
declare
  prod products;
  new_sale sales;
begin
  select * into prod from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  update products set qty = qty - p_qty where id = p_product_id;

  insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id)
  values (
    prod.id, prod.name, p_seller, p_qty, prod.price,
    prod.price * p_qty,
    round(prod.price * p_qty * prod.tithe_pct / 100, 2),
    prod.business_id
  )
  returning * into new_sale;

  return new_sale;
end;
$$;
