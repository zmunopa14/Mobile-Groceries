-- ============================================================
-- PAMUSIKA — Fix: Approve/Reject on pending businesses (and Reject on
-- pending payments) silently did nothing, because `businesses` has RLS
-- enabled with only a SELECT policy — there was never an UPDATE or
-- DELETE policy, so those writes were being silently blocked (no error,
-- since a blocked UPDATE/DELETE under RLS just affects zero rows). A
-- manual SQL fix in this editor always "worked" because it runs as the
-- database superuser, which bypasses RLS entirely.
--
-- Rather than opening businesses up to direct writes from anyone holding
-- the app's public key (it holds subscription/payment-gating data), these
-- go through SECURITY DEFINER functions instead — same pattern already
-- used for approve_payment.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

create or replace function approve_pending_business(p_id integer)
returns void
language plpgsql security definer as $$
begin
  update businesses set approved = true where id = p_id;
end; $$;

create or replace function reject_pending_business(p_id integer)
returns void
language plpgsql security definer as $$
begin
  delete from members where business_id = p_id;
  delete from businesses where id = p_id;
end; $$;

create or replace function reject_payment(p_id uuid)
returns void
language plpgsql security definer as $$
begin
  update payments set status = 'rejected' where id = p_id;
end; $$;
