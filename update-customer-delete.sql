-- ============================================================
-- PAMUSIKA — Update: customer details + delete-sale-and-restock
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- Safe on existing data.
-- ============================================================

-- 1. Customer name and phone on sales
alter table sales add column if not exists customer_name  text;
alter table sales add column if not exists customer_phone text;

-- 2. record_invoice now also stores the customer name + phone
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

  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'qty')::integer;
    if prod.qty < q then raise exception 'Not enough stock for %', prod.name; end if;
  end loop;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    q := (item->>'qty')::integer;
    update products set qty = qty - q where id = prod.id;
    insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no, customer_name, customer_phone)
    values (prod.id, prod.name, p_seller, q, prod.price,
      prod.price * q, round(prod.price * q * prod.tithe_pct / 100, 2), prod.business_id, inv, p_customer, p_phone);
  end loop;

  return inv;
end; $$;

-- 3. Delete a whole invoice and RETURN its stock to inventory
create or replace function delete_invoice(p_invoice_no text)
returns void
language plpgsql security definer as $$
declare
  s sales;
begin
  for s in select * from sales where invoice_no = p_invoice_no loop
    if s.product_id is not null then
      update products set qty = qty + s.qty where id = s.product_id;
    end if;
  end loop;
  delete from sales where invoice_no = p_invoice_no;
end; $$;

-- 4. Delete a single sale row (for older sales with no invoice number) and return its stock
create or replace function delete_sale(p_sale_id uuid)
returns void
language plpgsql security definer as $$
declare
  s sales;
begin
  select * into s from sales where id = p_sale_id;
  if not found then return; end if;
  if s.product_id is not null then
    update products set qty = qty + s.qty where id = s.product_id;
  end if;
  delete from sales where id = p_sale_id;
end; $$;
