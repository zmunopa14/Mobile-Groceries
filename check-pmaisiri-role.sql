-- DIAGNOSTIC ONLY — checks whether P Maisiri's account is an "admin"
-- (sees the Sales/Transactions tab where this feature lives) or a
-- plain "seller" (currently can't reach it).
select name, role from members where business_id = 3;
