-- ============================================================
-- PAMUSIKA — Marange Econet (business id 32): set up the 3% "To God"
-- rate on the fortnightly Econet commission ahead of time. The
-- commission amount itself isn't fixed (Econet decides it each time),
-- so that dollar figure isn't set here — she'll type it into
-- Report → Salary settings → "Salary from your job" whenever a new
-- commission comes in, and the 3% comes out automatically.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

do $$
begin
  if exists (select 1 from business_salary_settings where business_id = 32) then
    update business_salary_settings set outside_tithe_pct = 3 where business_id = 32;
  else
    insert into business_salary_settings (business_id, outside_tithe_pct) values (32, 3);
  end if;
end $$;
