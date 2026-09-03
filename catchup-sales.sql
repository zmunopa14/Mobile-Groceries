-- ============================================================
-- PAMUSIKA — Update: record a lump-sum "catch-up" sale for a day
-- when a seller only knows the TOTAL they actually made (worked out
-- by hand) but forgot to log some of the individual items — instead
-- of forcing them to itemize sales they can't remember, they enter
-- the true total and the app records just the shortfall as one entry,
-- not tied to any specific product (so it doesn't touch stock).
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Purely additive — no existing table's columns are changed.
-- ============================================================

create or replace function record_catchup_sale(
  p_business_id integer, p_seller text, p_amount numeric, p_tithe_pct numeric,
  p_note text default null, p_sold_at timestamptz default null
)
returns sales language plpgsql security definer as $$
declare new_sale sales;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  insert into sales (product_id, product_name, seller_name, qty, unit_price, total, tithe, business_id, sold_at)
  values (
    null, coalesce(nullif(trim(p_note), ''), 'Catch-up entry'), p_seller, 1, p_amount, p_amount,
    round(p_amount * coalesce(p_tithe_pct, 0) / 100, 2), p_business_id, coalesce(p_sold_at, now())
  )
  returning * into new_sale;
  return new_sale;
end; $$;
