-- ============================================================
-- PAMUSIKA — Update: record a sale for a day that's already
-- passed, not only for right now. Adds an optional p_sold_at to
-- record_invoice — omitted (or null), it behaves exactly as before
-- (stamped with the current time).
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

drop function if exists record_invoice(jsonb, text, text, text);
create or replace function record_invoice(p_items jsonb, p_seller text, p_customer text, p_phone text, p_sold_at timestamptz default null)
returns text
language plpgsql security definer as $$
declare
  item jsonb;
  prod products;
  q integer;
  inv text;
  ts timestamptz := coalesce(p_sold_at, now());
begin
  inv := 'INV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'qty')::integer;
    update products set qty = qty - q where id = prod.id;   -- may go negative on purpose
    insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no, customer_name, customer_phone, sold_at)
    values (prod.id, prod.name, p_seller, q, prod.price,
      prod.price * q, round(prod.price * q * prod.tithe_pct / 100, 2), prod.business_id, inv, p_customer, p_phone, ts);
  end loop;

  return inv;
end; $$;
