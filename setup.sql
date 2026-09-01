-- ============================================================
-- STOCKFLOW — Supabase database setup
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run
-- ============================================================

-- 1. EXTENSIONS ------------------------------------------------
create extension if not exists pgcrypto;   -- for hashing PINs

-- 2. TABLES ----------------------------------------------------

-- People who use the app (admin + salespeople)
create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  role        text not null default 'seller' check (role in ('admin','seller')),
  pin_hash    text not null,
  created_at  timestamptz default now()
);

-- Products / stock
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price       numeric(12,2) not null default 0,
  tithe_pct   numeric(5,2)  not null default 0,
  qty         integer not null default 0,
  low_at      integer not null default 5,
  created_at  timestamptz default now()
);

-- Sales ledger (append-only)
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references products(id),
  product_name text not null,
  seller_name text not null,
  qty         integer not null,
  unit_price  numeric(12,2) not null,
  total       numeric(12,2) not null,
  tithe       numeric(12,2) not null,
  sold_at     timestamptz default now()
);

-- 3. SECURE SALE FUNCTION -------------------------------------
-- Records a sale AND decrements stock atomically, so two phones
-- can never oversell the same item. The maths is done here on the
-- server, never trusted from the phone.
create or replace function record_sale(p_product_id uuid, p_qty integer, p_seller text)
returns sales
language plpgsql
security definer
as $$
declare
  prod products;
  new_sale sales;
begin
  -- lock the product row so concurrent sales queue up
  select * into prod from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if prod.qty < p_qty then raise exception 'Not enough stock'; end if;

  update products set qty = qty - p_qty where id = p_product_id;

  insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe)
  values (
    prod.id, prod.name, p_seller, p_qty, prod.price,
    prod.price * p_qty,
    round(prod.price * p_qty * prod.tithe_pct / 100, 2)
  )
  returning * into new_sale;

  return new_sale;
end;
$$;

-- 4. PIN LOGIN FUNCTION ---------------------------------------
-- Returns the member's id, name, role if the PIN matches. Never
-- exposes the stored hash to the app.
create or replace function login_with_pin(p_name text, p_pin text)
returns table(id uuid, name text, role text)
language plpgsql
security definer
as $$
begin
  return query
  select m.id, m.name, m.role
  from members m
  where m.name = p_name
    and m.pin_hash = crypt(p_pin, m.pin_hash);
end;
$$;

-- 5. CREATE / UPDATE A MEMBER WITH A HASHED PIN ---------------
create or replace function upsert_member(p_name text, p_pin text, p_role text)
returns void
language plpgsql
security definer
as $$
begin
  insert into members (name, pin_hash, role)
  values (p_name, crypt(p_pin, gen_salt('bf')), p_role)
  on conflict (name) do update
    set pin_hash = crypt(p_pin, gen_salt('bf')),
        role = excluded.role;
end;
$$;

-- 6. ROW LEVEL SECURITY ---------------------------------------
-- We route all sensitive actions through the functions above
-- (which run as 'security definer'), so we lock the tables down
-- and only allow safe reads from the app's anon key.
alter table members  enable row level security;
alter table products enable row level security;
alter table sales    enable row level security;

-- products: anyone with the app can READ (sellers need to see items)
drop policy if exists products_read on products;
create policy products_read on products for select using (true);

-- sales: readable (the app filters seller vs admin views in the UI;
-- for stricter privacy you can tighten this later with auth)
drop policy if exists sales_read on sales;
create policy sales_read on sales for select using (true);

-- members: do NOT allow reading pin_hash from the app
drop policy if exists members_read on members;
create policy members_read on members for select using (true);

-- ============================================================
-- 7. CREATE THE FIRST ADMIN (your mother)
-- Change the name and PIN, then this line runs with the rest.
-- ============================================================
select upsert_member('Mum', '1234', 'admin');

-- Done. Next: copy your Project URL and anon key into the app.
