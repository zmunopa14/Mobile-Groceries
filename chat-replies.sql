-- ============================================================
-- PAMUSIKA — Update: reply to one specific message instead of only
-- ever appending to the end of the conversation — useful once a
-- thread (agent chat, a direct message, or the community room) has
-- built up many messages and it's not obvious which one a reply is
-- actually answering.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

alter table order_request_messages add column if not exists reply_to_id uuid references order_request_messages(id);
alter table community_chat_messages add column if not exists reply_to_id uuid references community_chat_messages(id);

drop function if exists send_order_request_message(integer, integer, integer, text, uuid);
create or replace function send_order_request_message(
  p_requester_business_id integer, p_supplier_business_id integer,
  p_sender_business_id integer, p_body text, p_order_request_id uuid default null,
  p_reply_to_id uuid default null
)
returns order_request_messages language plpgsql security definer as $$
declare result order_request_messages;
begin
  insert into order_request_messages(order_request_id, requester_business_id, supplier_business_id, sender_business_id, body, reply_to_id)
  values (p_order_request_id, p_requester_business_id, p_supplier_business_id, p_sender_business_id, p_body, p_reply_to_id)
  returning * into result;
  return result;
end; $$;

create or replace function send_community_message(p_business_id integer, p_sender_name text, p_body text, p_reply_to_id uuid default null)
returns community_chat_messages language plpgsql security definer as $$
declare result community_chat_messages;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'Message cannot be empty'; end if;
  insert into community_chat_messages(business_id, sender_name, body, reply_to_id)
  values (p_business_id, trim(p_sender_name), trim(p_body), p_reply_to_id)
  returning * into result;
  return result;
end; $$;
