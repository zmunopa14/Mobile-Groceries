-- ============================================================
-- PAMUSIKA — Master Pee (business id 3): 1% of total sales counted
-- as "To God from sales," on top of the 3% already stamped on each
-- daily catch-up entry — shows automatically in the Report tab under
-- Salary & giving, computed straight off sales (no separate salary
-- amount involved, since sales_salary_pct stays at 0).
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

do $$
begin
  if exists (select 1 from business_salary_settings where business_id = 3) then
    update business_salary_settings set sales_salary_tithe_pct = 1 where business_id = 3;
  else
    insert into business_salary_settings (business_id, sales_salary_pct, sales_salary_tithe_pct)
    values (3, 0, 1);
  end if;
end $$;
