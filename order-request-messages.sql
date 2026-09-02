-- ============================================================
-- PAMUSIKA — Update: free-text messaging on an order_requests thread,
-- alongside the existing structured order/fulfill/reject flow. Lets
-- either side (requester or supplier) ask a clarifying question or
-- reply in plain text instead of only ever picking products.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive: no existing table's columns are changed.
-- Uses the existing wide-open RLS posture of the shop tables
-- (this is shop reorder logistics, not sensitive financial data).
-- ============================================================

create table if not exists order_request_messages (
  id                 uuid primary key default gen_random_uuid(),
  order_request_id   uuid not null references order_requests(id),
  sender_business_id integer not null references businesses(id),
  body               text not null,
  created_at         timestamptz not null default now()
);
create index if not exists order_request_messages_thread_idx on order_request_messages(order_request_id, created_at);

alter table order_request_messages enable row level security;
drop policy if exists order_request_messages_rw on order_request_messages;
create policy order_request_messages_rw on order_request_messages for all using (true) with check (true);

create or replace function send_order_request_message(p_order_request_id uuid, p_sender_business_id integer, p_body text)
returns order_request_messages language plpgsql security definer as $$
declare result order_request_messages;
begin
  insert into order_request_messages(order_request_id, sender_business_id, body)
  values (p_order_request_id, p_sender_business_id, p_body)
  returning * into result;
  return result;
end; $$;
