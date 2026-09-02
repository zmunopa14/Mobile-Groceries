-- ============================================================
-- PAMUSIKA — Update: the Owner approves new self-registered
-- businesses before they can use the app, so someone can't just keep
-- registering throwaway accounts. Every EXISTING business is left
-- fully approved (default true) — this only affects new registrations
-- going forward, which register_business now creates as unapproved.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

alter table businesses add column if not exists approved boolean not null default true;

create or replace function register_business(p_business_name text, p_owner_name text, p_pin text)
returns table(id uuid, name text, role text, business_id integer, exempt boolean)
language plpgsql security definer as $$
declare
  clean_biz  text := trim(p_business_name);
  clean_name text := trim(p_owner_name);
  new_biz_id integer;
  new_member members;
begin
  if clean_biz is null or length(clean_biz) = 0 then
    raise exception 'Business name is required';
  end if;
  if clean_name is null or length(clean_name) = 0 then
    raise exception 'Your name is required';
  end if;
  if p_pin is null or length(p_pin) < 4 then
    raise exception 'PIN must be at least 4 digits';
  end if;
  if exists (select 1 from businesses where lower(businesses.name) = lower(clean_biz)) then
    raise exception 'A business with that name already exists';
  end if;
  if exists (select 1 from members where lower(members.name) = lower(clean_name)) then
    raise exception 'That name is already taken — try a different name';
  end if;

  perform pg_advisory_xact_lock(hashtext('businesses_id'));
  select coalesce(max(businesses.id), 0) + 1 into new_biz_id from businesses;

  -- unapproved until the Owner reviews it — the free-week trial still
  -- starts now, so it's ready to go the moment it's approved.
  insert into businesses (id, name, paid_until, approved) values (new_biz_id, clean_biz, now() + interval '7 days', false);

  insert into members (name, pin_hash, role, business_id, exempt)
  values (clean_name, crypt(p_pin, gen_salt('bf')), 'admin', new_biz_id, false)
  returning * into new_member;

  return query select new_member.id, new_member.name, new_member.role, new_member.business_id, new_member.exempt;
end; $$;
