-- ============================================================
-- PAMUSIKA — Update: one shared chat room every business on the
-- app can see and post in, separate from the private business↔agent
-- conversations (order-chat-general.sql). Run ONCE in Supabase →
-- SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- Same wide-open RLS posture as the rest of the shop tables.
-- ============================================================

create table if not exists community_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  business_id   integer not null references businesses(id),
  sender_name   text not null,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists community_chat_messages_created_idx on community_chat_messages(created_at);

alter table community_chat_messages enable row level security;
drop policy if exists community_chat_messages_rw on community_chat_messages;
create policy community_chat_messages_rw on community_chat_messages for all using (true) with check (true);

create or replace function send_community_message(p_business_id integer, p_sender_name text, p_body text)
returns community_chat_messages language plpgsql security definer as $$
declare result community_chat_messages;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'Message cannot be empty'; end if;
  insert into community_chat_messages(business_id, sender_name, body)
  values (p_business_id, trim(p_sender_name), trim(p_body))
  returning * into result;
  return result;
end; $$;
