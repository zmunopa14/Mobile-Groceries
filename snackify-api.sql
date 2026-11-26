-- ============================================================
-- PAMUSIKA — Snackify procurement link.
--
-- Lets Snackify's own backend (no login, just this key) pull pending
-- orders sent to it from the Order tab, and report back the actual
-- price paid + a receipt once bought — which turns into a bill the
-- originating business can see and settle under a new "Bills" tab.
--
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

create table if not exists api_keys (
  name text primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);
alter table api_keys enable row level security;
revoke all on api_keys from anon, authenticated;

create table if not exists procurement_bills (
  id                 uuid primary key default gen_random_uuid(),
  order_request_id   uuid not null references order_requests(id),
  business_id        integer not null references businesses(id),  -- who owes
  amount             numeric(12,2) not null,
  receipt_url        text,
  status             text not null default 'unpaid' check (status in ('unpaid','paid')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
alter table procurement_bills enable row level security;
drop policy if exists procurement_bills_rw on procurement_bills;
create policy procurement_bills_rw on procurement_bills for all using (true) with check (true);

create or replace function snackify_check_key(p_api_key text) returns void
language plpgsql as $$
begin
  if not exists (select 1 from api_keys where name = 'snackify' and key_hash = crypt(p_api_key, key_hash)) then
    raise exception 'Invalid API key';
  end if;
end; $$;

-- Snackify's "what's new to buy" poll — every pending order sent to its
-- business id, newest last, with whatever recommended_price was set per
-- line item (if any) still inside `items`.
create or replace function snackify_list_orders(p_api_key text, p_snackify_business_id integer)
returns table (id uuid, business_id integer, business_name text, items jsonb, note text, created_at timestamptz)
language plpgsql security definer as $$
begin
  perform snackify_check_key(p_api_key);
  return query
    select r.id, r.requester_business_id, b.name, r.items, r.note, r.created_at
    from order_requests r join businesses b on b.id = r.requester_business_id
    where r.supplier_business_id = p_snackify_business_id and r.status = 'pending'
    order by r.created_at asc;
end; $$;

-- Snackify reports actual prices + the total it actually cost + a receipt
-- link once bought. Marks the order fulfilled and creates the bill the
-- requesting business will see and settle in Pamusika.
create or replace function snackify_fulfill_order(p_api_key text, p_order_id uuid, p_items jsonb, p_total_amount numeric, p_receipt_url text default null)
returns void
language plpgsql security definer as $$
declare req order_requests;
begin
  perform snackify_check_key(p_api_key);
  if p_total_amount is null or p_total_amount <= 0 then raise exception 'Total amount must be greater than 0'; end if;
  update order_requests set status = 'fulfilled', fulfilled_at = now(), items = p_items
    where id = p_order_id and status = 'pending' returning * into req;
  if not found then raise exception 'Order not found or already actioned'; end if;
  insert into procurement_bills (order_request_id, business_id, amount, receipt_url)
  values (p_order_id, req.requester_business_id, p_total_amount, p_receipt_url);
end; $$;

-- ------------------------------------------------------------
-- One-time setup below — uncomment and fill in before running.
-- ------------------------------------------------------------

-- 1) Register Snackify as a business (no login needed — it only ever
--    talks through the two functions above). Zimbabwean-shop businesses
--    in this app allocate ids manually; this picks the next free one.
-- insert into businesses (id, name, approved, paid_until)
--   select coalesce(max(id), 0) + 1, 'Snackify', true, null from businesses
--   returning id;   -- note this id, used below

-- 2) Point Samah Valley and Chiwitsi's default supplier at that id
--    (replace <snackify_id> with the id returned above):
-- insert into business_supplier_links (business_id, supplier_business_id)
--   select id, <snackify_id> from businesses where name in ('Samah Valley', 'Chiwitsi')
--   on conflict (business_id) do update set supplier_business_id = excluded.supplier_business_id;

-- 3) Store Snackify's API key, hashed. Generate a real random key yourself
--    (don't use a guessable word) and paste it in place of
--    REPLACE_WITH_REAL_KEY below — that exact string is what you then
--    hand to whoever runs Snackify's backend. It's never stored in plain
--    text anywhere, only this hash.
-- insert into api_keys (name, key_hash) values ('snackify', crypt('REPLACE_WITH_REAL_KEY', gen_salt('bf')))
--   on conflict (name) do update set key_hash = excluded.key_hash;
