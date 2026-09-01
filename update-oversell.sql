-- ============================================================
-- PAMUSIKA — Update: allow selling past zero (stock can go negative)
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- The sale functions no longer block when stock is low; the admin
-- restocks later and the negative number is corrected.
-- ============================================================

create or replace function record_invoice(p_items jsonb, p_seller text, p_customer text, p_phone text)
returns text
language plpgsql security definer as $$
declare
  item jsonb;
  prod products;
  q integer;
  inv text;
begin
  inv := 'INV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  -- No stock check: we allow selling even when stock is low or zero.
  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'qty')::integer;
    update products set qty = qty - q where id = prod.id;   -- may go negative on purpose
    insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no, customer_name, customer_phone)
    values (prod.id, prod.name, p_seller, q, prod.price,
      prod.price * q, round(prod.price * q * prod.tithe_pct / 100, 2), prod.business_id, inv, p_customer, p_phone);
  end loop;

  return inv;
end; $$;
