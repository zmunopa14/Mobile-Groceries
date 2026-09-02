-- ============================================================
-- PAMUSIKA — Update: general chat between a business and its agent,
-- not just messages tied to a specific order. Previously a message
-- always had to attach to an order_requests row (order_request_id
-- was required), so two sides couldn't talk at all until an order
-- existed. Now a conversation is keyed by the business pair, and
-- order_request_id is just optional context on a message.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Safe standalone: creates order_request_messages if it doesn't
-- already exist (in case order-request-messages.sql was never run),
-- otherwise just widens it. Purely additive — no existing row loses data.
-- ============================================================

create table if not exists order_request_messages (
  id                 uuid primary key default gen_random_uuid(),
  order_request_id   uuid references order_requests(id),
  sender_business_id integer not null references businesses(id),
  body               text not null,
  created_at         timestamptz not null default now()
);
alter table order_request_messages enable row level security;
drop policy if exists order_request_messages_rw on order_request_messages;
create policy order_request_messages_rw on order_request_messages for all using (true) with check (true);

alter table order_request_messages alter column order_request_id drop not null;
alter table order_request_messages add column if not exists requester_business_id integer references businesses(id);
alter table order_request_messages add column if not exists supplier_business_id integer references businesses(id);

-- Backfill the pair columns for every message sent before this update,
-- from the order it was attached to.
update order_request_messages m
   set requester_business_id = o.requester_business_id,
       supplier_business_id = o.supplier_business_id
  from order_requests o
 where m.order_request_id = o.id
   and m.requester_business_id is null;

alter table order_request_messages alter column requester_business_id set not null;
alter table order_request_messages alter column supplier_business_id set not null;

create index if not exists order_request_messages_pair_idx
  on order_request_messages(requester_business_id, supplier_business_id, created_at);

drop function if exists send_order_request_message(uuid, integer, text);
create or replace function send_order_request_message(
  p_requester_business_id integer, p_supplier_business_id integer,
  p_sender_business_id integer, p_body text, p_order_request_id uuid default null
)
returns order_request_messages language plpgsql security definer as $$
declare result order_request_messages;
begin
  insert into order_request_messages(order_request_id, requester_business_id, supplier_business_id, sender_business_id, body)
  values (p_order_request_id, p_requester_business_id, p_supplier_business_id, p_sender_business_id, p_body)
  returning * into result;
  return result;
end; $$;
