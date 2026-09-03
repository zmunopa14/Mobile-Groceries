-- ============================================================
-- PAMUSIKA — migration status check. Read-only: run this any time
-- in Supabase → SQL Editor to see which of the .sql files in this
-- project have actually been applied to this database. Nothing here
-- changes anything.
-- ============================================================

select 'register-business.sql' as migration,
  (to_regprocedure('public.register_business(text,text,text)') is not null) as applied
union all
select 'order-requests.sql',
  (to_regclass('public.order_requests') is not null) and (to_regclass('public.business_supplier_links') is not null)
union all
select 'order-request-messages.sql (base table)',
  (to_regclass('public.order_request_messages') is not null)
union all
select 'order-chat-general.sql (general chat, not just order-attached)',
  exists (select 1 from information_schema.columns
          where table_name = 'order_request_messages' and column_name = 'requester_business_id')
union all
select 'multi-supplier-products.sql',
  exists (select 1 from information_schema.columns
          where table_name = 'products' and column_name = 'supplier_business_id')
union all
select 'community-chat.sql',
  (to_regclass('public.community_chat_messages') is not null)
union all
select 'business-salary.sql',
  (to_regclass('public.business_salary_settings') is not null)
  and (to_regclass('public.business_salary_categories') is not null)
  and exists (select 1 from information_schema.columns
              where table_name = 'business_salary_categories' and column_name = 'tithe_pct')
union all
select 'reseller-reports.sql',
  (to_regclass('public.category_business_links') is not null)
  and (to_regclass('public.received_reseller_reports') is not null)
union all
select 'report-settings.sql',
  (to_regclass('public.business_report_settings') is not null)
union all
select 'business-approval.sql',
  exists (select 1 from information_schema.columns
          where table_name = 'businesses' and column_name = 'approved')
union all
select 'drop-church-module.sql (no church objects remain)',
  not exists (select 1 from information_schema.tables where table_name like 'church\_%' escape '\')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and (p.proname like 'church\_%' escape '\' or p.proname like '\_church\_%' escape '\'))
order by migration;
