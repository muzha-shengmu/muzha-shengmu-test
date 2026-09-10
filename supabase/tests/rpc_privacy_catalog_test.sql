-- NOT RUN：Owner 執行後，才可判斷這兩支真實 DB 函式是否已更新。
-- 僅讀函式定義，不查詢或回傳任何信眾資料；不等於 RPC 端到端測試。
begin;
create temporary table mzsm_privacy_test_result(function_name text, status text) on commit drop;
do $test$
declare fn text; oid_value oid; body text;
begin
  foreach fn in array array['mzsm_public_lookup_light','mzsm_public_lookup_taisui'] loop
    oid_value:=to_regprocedure(format('public.%I(text,text)',fn));
    if oid_value is null then raise exception 'PRIVACY_FAIL: missing lookup function %',fn; end if;
    select pg_get_functiondef(oid_value) into body;
    if body ~ '''(name|phone|target|birth)''[[:space:]]*,' then
      raise exception 'PRIVACY_FAIL: public personal field still present in %',fn;
    end if;
    if not exists(select 1 from pg_proc where oid=oid_value and prosecdef) then
      raise exception 'PRIVACY_FAIL: unexpected execution mode in %',fn;
    end if;
    insert into pg_temp.mzsm_privacy_test_result values(fn,'PASS');
  end loop;
end
$test$;
select jsonb_build_object('test','RPC privacy catalog test','status','PASS',
  'results',jsonb_agg(to_jsonb(r)),'rpc_end_to_end','NOT RUN') as report
from pg_temp.mzsm_privacy_test_result r;
rollback;
