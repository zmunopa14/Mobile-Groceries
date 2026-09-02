-- ============================================================
-- PAMUSIKA — Update: one free week for newly self-created project
-- businesses, and remove an exemption now that it's paid normally.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

-- 1. A member creating their own project business (self-service,
--    during church registration) now gets exactly one free week
--    before the normal weekly-payment paywall applies — same as
--    every other business, just with a one-week head start. Every
--    OTHER existing business's paid_until is left exactly as-is.
create or replace function church_create_project_business(p_token text, p_member_id uuid, p_business_name text)
returns table(business_id integer, business_name text)
language plpgsql security definer as $$
declare
  caller church_members;
  already_linked integer;
  new_biz_id integer;
  clean_name text;
begin
  caller := _church_resolve_session(p_token);
  perform _church_assert_member_scope(caller, p_member_id);

  clean_name := trim(p_business_name);
  if clean_name is null or length(clean_name) = 0 then
    raise exception 'Business name is required';
  end if;

  select linked_business_id into already_linked from church_members where id = p_member_id;
  if already_linked is not null then
    raise exception 'This member already has a linked business';
  end if;

  insert into businesses(name, paid_until) values (clean_name, now() + interval '7 days')
  returning id into new_biz_id;

  update church_members set linked_business_id = new_biz_id, updated_at = now() where id = p_member_id;

  return query select new_biz_id, clean_name;
end; $$;

-- 2. Samah Valley paid normally, so this person no longer needs the
--    exemption that was skipping the paywall for them — the next
--    payment cycle should apply to them like everyone else.
alter table members add column if not exists exempt boolean not null default false;
update members set exempt = false where name = 'Munopa';
