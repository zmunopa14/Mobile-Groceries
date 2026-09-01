-- ============================================================
-- PAMUSIKA — Update: multi-item invoices + business names
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- Safe on existing data.
-- ============================================================

-- 1. Give the two businesses their real names
update businesses set name = 'Samah Valley' where id = 1;
update businesses set name = 'Chiwitsi'     where id = 2;

-- 2. Sales get an invoice number so several items can share one receipt
alter table sales add column if not exists invoice_no text;

-- 3. New function: record a whole basket (multiple items) as ONE invoice.
--    Takes a JSON list like: [{"product_id":"...","qty":50}, ...]
--    Deducts stock for each line, calculates totals, stamps them all
--    with the same invoice number, and returns that invoice number.
create or replace function record_invoice(p_items jsonb, p_seller text)
returns text
language plpgsql security definer as $$
declare
  item jsonb;
  prod products;
  q integer;
  inv text;
begin
  -- make a short invoice number like INV-7F3A2B
  inv := 'INV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  -- first pass: check stock for every line before changing anything
  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'qty')::integer;
    if prod.qty < q then raise exception 'Not enough stock for %', prod.name; end if;
  end loop;

  -- second pass: deduct stock and write each line with the shared invoice number
  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    q := (item->>'qty')::integer;
    update products set qty = qty - q where id = prod.id;
    insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no)
    values (prod.id, prod.name, p_seller, q, prod.price,
      prod.price * q, round(prod.price * q * prod.tithe_pct / 100, 2), prod.business_id, inv);
  end loop;

  return inv;
end; $$;
