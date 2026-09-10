-- RLS negative DB test: NOT RUN，直到 Owner 執行並回貼原始結果。
-- 不寫入八張正式表、不回傳正式資料；只建立暫存結果，最後 ROLLBACK。
-- LIMIT 0 刻意不取資料；必須得到 42501 才算直接 SELECT 被拒絕。
-- 另驗證實際 RLS、restrictive deny policy 及所有直接讀寫/欄位權限。
begin;
set local statement_timeout='30s';
create temporary table mzsm_rls_test_result(table_name text, tested_role text, status text) on commit drop;
do $test$
declare t text; role_name text; rel oid; denied boolean;
begin
  foreach t in array array['mzsm_counters','mzsm_admins','mzsm_announcements','mzsm_pilgrimage','mzsm_lights','mzsm_taisui','mzsm_idempotency','mzsm_lookup_attempts'] loop
    rel:=to_regclass(format('public.%I',t));
    if rel is null or not exists(select 1 from pg_class where oid=rel and relkind='r' and relrowsecurity) then
      raise exception 'RLS_FAIL: table missing or RLS disabled: %',t;
    end if;
    if not exists(select 1 from pg_policy where polrelid=rel and polname='mzsm_deny_direct'
       and not polpermissive and polcmd='*' and polroles=array[0::oid]
       and pg_get_expr(polqual,polrelid)='false'
       and pg_get_expr(polwithcheck,polrelid)='false') then
      raise exception 'RLS_FAIL: restrictive PUBLIC deny policy missing or altered: %',t;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if not exists(select 1 from pg_roles where rolname=role_name and not rolsuper and not rolbypassrls) then
        raise exception 'RLS_FAIL: application role can bypass RLS: %',role_name;
      end if;
      if has_table_privilege(role_name,rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(role_name,rel,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'RLS_FAIL: direct privileges remain on % for %',t,role_name;
      end if;
      denied:=false;
      execute format('set local role %I',role_name);
      begin
        execute format('select 1 from public.%I limit 0',t);
      exception when insufficient_privilege then
        denied:=true;
      end;
      reset role;
      if not denied then
        raise exception 'RLS_FAIL: direct select did not raise 42501: % / %',t,role_name;
      end if;
      insert into pg_temp.mzsm_rls_test_result values(t,role_name,'PASS');
    end loop;
  end loop;
  if (select count(*) from pg_temp.mzsm_rls_test_result)<>16 then
    raise exception 'RLS_FAIL: expected 16 table/role results';
  end if;
end
$test$;
select jsonb_build_object('test','RLS negative DB test','status','PASS',
 'table_count',count(distinct table_name),'role_checks',count(*),
 'method','catalog guards plus direct SELECT LIMIT 0 rejected with 42501',
 'rpc_positive_tests','NOT RUN',
 'results',jsonb_agg(to_jsonb(r) order by table_name,tested_role)) as report
from pg_temp.mzsm_rls_test_result r;
rollback;
