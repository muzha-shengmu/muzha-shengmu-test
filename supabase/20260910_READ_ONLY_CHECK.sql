-- 僅讀系統目錄，不讀宮務資料、不建立資料表。請先執行並回貼結果。
select current_database() as database_name, current_user as executor,
       current_setting('server_version') as postgres_version;
with expected(name) as (select unnest(array['mzsm_counters','mzsm_admins','mzsm_announcements','mzsm_pilgrimage','mzsm_lights','mzsm_taisui','mzsm_idempotency','mzsm_lookup_attempts']))
select e.name as table_name, c.oid is not null as table_exists,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
       c.relkind as relation_kind,
       coalesce((select jsonb_agg(jsonb_build_object(
         'policy',p.polname,'permissive',p.polpermissive,
         'using',pg_get_expr(p.polqual,p.polrelid),
         'check',pg_get_expr(p.polwithcheck,p.polrelid)))
         from pg_policy p where p.polrelid=c.oid),'[]'::jsonb) as policies
from expected e left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=e.name
order by e.name;
-- 只列函式名稱與安全屬性；不輸出函式內可能存在的資料或設定值。
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       r.rolsuper or r.rolbypassrls as owner_bypasses_rls
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname like 'mzsm_%'
order by p.proname;
