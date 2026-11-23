-- DIAGNOSTIC ONLY
select now() as right_now, '2026-09-15 14:00:15.998681+00'::timestamptz as samah_valley_paid_until,
       now() > '2026-09-15 14:00:15.998681+00'::timestamptz as samah_valley_should_be_locked;
