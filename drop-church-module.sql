-- ============================================================
-- PAMUSIKA — remove all church-module database objects.
-- The church side of the app has been removed from the code;
-- this drops every function and table it created, in one pass,
-- without needing an exact list of every past migration file.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
--
-- Safe scope: only touches objects whose name starts with
-- `church_` or `_church_`. Nothing else — the shop/business
-- tables (products, sales, businesses, order_requests,
-- order_request_messages, business_supplier_links, etc.) are
-- untouched.
--
-- WARNING: this permanently deletes any pledge/debt/payment/
-- fundraising data already entered for real members. There is
-- no undo. Only run this if you're sure you don't need that
-- data anymore.
-- ============================================================

do $$
declare r record;
begin
  -- functions first (some are used by triggers on the tables)
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'church\_%' escape '\' or p.proname like '\_church\_%' escape '\')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;

  -- then tables (cascade takes indexes, RLS policies, grants, FKs with them)
  for r in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname like 'church\_%' escape '\'
  loop
    execute format('drop table if exists %s cascade', r.tbl);
  end loop;
end $$;
