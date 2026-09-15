-- DIAGNOSTIC ONLY — paste the full text result back, not a screenshot.
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'login_in_business' and n.nspname = 'public';
