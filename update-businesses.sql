-- ============================================================
-- STOCKFLOW — Update: two separate businesses
-- Run this ONCE in Supabase → SQL Editor → New query → paste → Run
-- Safe on your existing data: everything you already have is
-- assigned to Business 1 automatically.
-- ============================================================

-- 1. Businesses table
create table if not exists businesses (
  id    integer primary key,
  name  text not null
);

insert into businesses (id, name) values (1, 'Business 1')
  on conflict (id) do nothing;
insert into businesses (id, name) values (2, 'Business 2')
  on conflict (id) do nothing;

-- 2. Tag products, sales, members with a business_id (default 1 = existing data)
alter table products add column if not exists business_id integer not null default 1;
alter table sales    add column if not exists business_id integer not null default 1;
alter table members  add column if not exists business_id integer not null default 1;

-- 3. Update login to also return which business the person belongs to
create or replace function login_with_pin(p_name text, p_pin text)
returns table(id uuid, name text, role text, business_id integer)
language plpgsql security definer as $$
begin
  return query
  select m.id, m.name, m.role, m.business_id
  from members m
  where m.name = p_name and m.pin_hash = crypt(p_pin, m.pin_hash);
end; $$;

-- 4. Update member creation to include a business
create or replace function upsert_member(p_name text, p_pin text, p_role text, p_business_id integer)
returns void language plpgsql security definer as $$
begin
  insert into members (name, pin_hash, role, business_id)
  values (p_name, crypt(p_pin, gen_salt('bf')), p_role, p_business_id)
  on conflict (name) do update
    set pin_hash = crypt(p_pin, gen_salt('bf')),
        role = excluded.role,
        business_id = excluded.business_id;
end; $$;

-- 5. Record sale now stamps the sale with the product's business
create or replace function record_sale(p_product_id uuid, p_qty integer, p_seller text)
returns sales language plpgsql security definer as $$
declare prod products; new_sale sales;
begin
  select * into prod from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if prod.qty < p_qty then raise exception 'Not enough stock'; end if;
  update products set qty = qty - p_qty where id = p_product_id;
  insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id)
  values (prod.id, prod.name, p_seller, p_qty, prod.price,
    prod.price * p_qty, round(prod.price * p_qty * prod.tithe_pct / 100, 2), prod.business_id)
  returning * into new_sale;
  return new_sale;
end; $$;

-- 6. Create the second admin (Superuser2, business 2). Change the PIN if you like.
select upsert_member('Superuser2', '1234', 'admin', 2);

-- 7. Make sure your FIRST admin is on business 1.
--    Change 'Superuser' below if your first admin has a different name.
update members set business_id = 1 where role = 'admin' and name <> 'Superuser2';
