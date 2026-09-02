-- ============================================================
-- PAMUSIKA — Update: wholesale/retail agent ↔ member ordering
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run
-- Purely additive: no existing table's columns are changed.
-- Uses the existing wide-open RLS posture of the shop tables
-- (this is shop reorder logistics, not sensitive financial data).
-- ============================================================

-- A business's supplying agent — either a registered business in
-- this app (supplier_business_id) or a free-text fallback for an
-- agent not yet on the app (supplier_name/supplier_phone).
create table if not exists business_supplier_links (
  business_id           integer primary key references businesses(id),
  supplier_business_id  integer references businesses(id),
  supplier_name         text,
  supplier_phone        text,
  updated_at            timestamptz not null default now()
);

alter table business_supplier_links enable row level security;
drop policy if exists business_supplier_links_rw on business_supplier_links;
create policy business_supplier_links_rw on business_supplier_links for all using (true) with check (true);

create table if not exists order_requests (
  id                      uuid primary key default gen_random_uuid(),
  requester_business_id   integer not null references businesses(id),
  supplier_business_id    integer not null references businesses(id),
  items                   jsonb not null,   -- [{product_name, qty, unit}]
  note                    text,
  status                  text not null default 'pending' check (status in ('pending', 'fulfilled', 'rejected')),
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  fulfilled_at            timestamptz
);
create index if not exists order_requests_supplier_idx on order_requests(supplier_business_id, status);
create index if not exists order_requests_requester_idx on order_requests(requester_business_id, status);

alter table order_requests enable row level security;
drop policy if exists order_requests_rw on order_requests;
create policy order_requests_rw on order_requests for all using (true) with check (true);

create or replace function create_order_request(p_requester_business_id integer, p_supplier_business_id integer, p_items jsonb, p_note text default null)
returns order_requests language plpgsql security definer as $$
declare result order_requests;
begin
  insert into order_requests(requester_business_id, supplier_business_id, items, note)
  values (p_requester_business_id, p_supplier_business_id, p_items, p_note)
  returning * into result;
  return result;
end; $$;

create or replace function fulfill_order_request(p_id uuid, p_items jsonb default null)
returns order_requests language plpgsql security definer as $$
declare result order_requests;
begin
  update order_requests
     set status = 'fulfilled', fulfilled_at = now(), items = coalesce(p_items, items)
   where id = p_id and status = 'pending'
   returning * into result;
  if not found then raise exception 'Order request not found or already actioned'; end if;
  return result;
end; $$;

create or replace function reject_order_request(p_id uuid, p_reason text default null)
returns order_requests language plpgsql security definer as $$
declare result order_requests;
begin
  update order_requests
     set status = 'rejected', rejection_reason = p_reason
   where id = p_id and status = 'pending'
   returning * into result;
  if not found then raise exception 'Order request not found or already actioned'; end if;
  return result;
end; $$;
