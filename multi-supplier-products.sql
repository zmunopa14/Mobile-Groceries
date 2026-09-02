-- ============================================================
-- PAMUSIKA — Update: per-product supplier override, so different
-- products can be ordered from different agents instead of every
-- low-stock item going to one single business-wide supplier.
-- business_supplier_links stays as the DEFAULT supplier a product
-- uses when it has no override of its own. Run ONCE in Supabase →
-- SQL Editor → New query → paste → Run.
-- ============================================================

alter table products add column if not exists supplier_business_id integer references businesses(id);
alter table products add column if not exists supplier_name text;
alter table products add column if not exists supplier_phone text;
