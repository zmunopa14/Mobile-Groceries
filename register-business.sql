-- ============================================================
-- PAMUSIKA — self-service business registration.
-- The only place a new business could previously be created
-- in-app was through the (now removed) church onboarding wizard
-- ("New business" toggle → church_create_project_business). This
-- restores that capability as a plain shop-side registration
-- RPC, with no church/assembly/pledge concepts attached.
--
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

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

  -- businesses.id has no default generator, so pick the next one
  -- ourselves; the advisory lock keeps two simultaneous
  -- registrations from picking the same id.
  perform pg_advisory_xact_lock(hashtext('businesses_id'));
  select coalesce(max(businesses.id), 0) + 1 into new_biz_id from businesses;

  -- same one-week head start the old self-service flow gave a
  -- newly created project business, before the normal weekly
  -- paywall applies.
  insert into businesses (id, name, paid_until) values (new_biz_id, clean_biz, now() + interval '7 days');

  insert into members (name, pin_hash, role, business_id, exempt)
  values (clean_name, crypt(p_pin, gen_salt('bf')), 'admin', new_biz_id, false)
  returning * into new_member;

  return query select new_member.id, new_member.name, new_member.role, new_member.business_id, new_member.exempt;
end; $$;
