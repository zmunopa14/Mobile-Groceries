-- DIAGNOSTIC ONLY
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'businesses' and column_name = 'id')
   or (table_name = 'payments' and column_name = 'id')
   or (table_name = 'members' and column_name = 'business_id');
