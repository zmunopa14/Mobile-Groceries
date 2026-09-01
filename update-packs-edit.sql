-- ============================================================
-- PAMUSIKA — Update: packs only + edit invoices
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- IMPORTANT: this converts existing products from units to packs.
-- ============================================================

-- 1. Convert existing data from units to packs.
--    Stock: 100 units with pack_size 20 -> 5 packs.
--    Price: per-unit 0.475 with pack_size 20 -> 9.50 per pack.
--    pack_size is KEPT as a label (e.g. "pack of 20"); it no longer drives maths.
update products
set qty   = round(qty::numeric / greatest(pack_size, 1)),
    price = price * greatest(pack_size, 1)
where pack_size is not null and pack_size > 1;

-- 2. Edit an existing invoice: replace ALL its lines with a new set,
--    correctly returning the old stock and deducting the new.
--    p_items is a JSON list: [{"product_id":"...","packs":3}, ...]
create or replace function edit_invoice(p_invoice_no text, p_items jsonb, p_customer text, p_phone text)
returns void
language plpgsql security definer as $$
declare
  old_sale sales;
  item jsonb;
  prod products;
  q integer;
begin
  -- return stock from the existing lines
  for old_sale in select * from sales where invoice_no = p_invoice_no loop
    if old_sale.product_id is not null then
      update products set qty = qty + old_sale.qty where id = old_sale.product_id;
    end if;
  end loop;

  -- remove the old lines
  delete from sales where invoice_no = p_invoice_no;

  -- write the new lines and deduct their stock
  for item in select * from jsonb_array_elements(p_items) loop
    select * into prod from products where id = (item->>'product_id')::uuid for update;
    if not found then raise exception 'A product was not found'; end if;
    q := (item->>'packs')::integer;
    if q <> 0 then
      update products set qty = qty - q where id = prod.id;
      insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, invoice_no, customer_name, customer_phone)
      values (prod.id, prod.name,
        coalesce((select seller_name from sales where invoice_no = p_invoice_no limit 1), 'admin-edit'),
        q, prod.price, prod.price * q,
        round(prod.price * q * prod.tithe_pct / 100, 2),
        prod.business_id, p_invoice_no, p_customer, p_phone);
    end if;
  end loop;
end; $$;
