-- 木柵聖母宮｜RPC 契約測試
-- ============================================================
-- 用法（本機 PostgreSQL 16）：
--   psql -d mzsm -v ON_ERROR_STOP=1 -f supabase/tests/auth_shim.sql
--   psql -d mzsm -v ON_ERROR_STOP=1 -f supabase/tests/rpc_test.sql
--
-- 任何一項不符預期就 raise exception，整份中止。沒有「印出警告但繼續」。
-- 這份測試刻意包含「應該要失敗」的呼叫：權限、驗證、版本衝突、查詢節流。

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $test$
declare
  v_admin   uuid := '11111111-1111-1111-1111-111111111111';
  v_user    uuid := '22222222-2222-2222-2222-222222222222';
  v_result  jsonb;
  v_result2 jsonb;
  v_code    text;
  v_version integer;
  v_count   integer;
  v_state   text;
  v_ok      boolean;
begin
  -- 乾淨起點
  delete from public.mzsm_idempotency;
  delete from public.mzsm_lookup_attempts;
  delete from public.mzsm_lights;
  delete from public.mzsm_pilgrimage;
  delete from public.mzsm_taisui;
  delete from public.mzsm_announcements;
  delete from public.mzsm_admins;
  delete from public.mzsm_counters;

  insert into public.mzsm_admins (user_id, email) values (v_admin, 'admin@example.test');

  -- ────────────────────────────────────────────────────────────
  raise notice '── 1. 未登入者不得直接讀取任何資料表 ──';
  -- ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform 1 from public.mzsm_lights limit 1;
    reset role;
    raise exception 'FAIL: anon 竟然可以直接查 mzsm_lights';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS  anon 直接查 mzsm_lights 被拒（42501）';
    when others then
      reset role;
      if sqlstate = 'P0001' then raise; end if;
      raise notice 'PASS  anon 直接查 mzsm_lights 被拒（%）', sqlstate;
  end;

  set local role anon;
  begin
    perform 1 from public.mzsm_admins limit 1;
    reset role;
    raise exception 'FAIL: anon 竟然可以直接查 mzsm_admins';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS  anon 直接查 mzsm_admins 被拒';
    when others then
      reset role;
      if sqlstate = 'P0001' then raise; end if;
      raise notice 'PASS  anon 直接查 mzsm_admins 被拒（%）', sqlstate;
  end;

  -- ────────────────────────────────────────────────────────────
  raise notice '── 2. 南巡進香：建立、冪等、驗證、查詢 ──';
  -- ────────────────────────────────────────────────────────────
  v_result := public.mzsm_public_create_pilgrimage(
    '  測試信眾甲  ', '0912345678', 2, 1, '測試備註', 'mzsm-test-pilgrim-0001');
  v_code := v_result ->> 'code';
  if v_code !~ '^MSM-\d{4}-0001$' then
    raise exception 'FAIL: 報名碼格式不符：%', v_code;
  end if;
  if v_result ->> 'status' <> '待確認' then
    raise exception 'FAIL: 初始狀態不是待確認：%', v_result;
  end if;
  raise notice 'PASS  建立報名 % 狀態 %', v_code, v_result ->> 'status';

  -- 姓名前後空白應被修剪
  select name into v_state from public.mzsm_pilgrimage where id = v_code;
  if v_state <> '測試信眾甲' then
    raise exception 'FAIL: 姓名未修剪空白：[%]', v_state;
  end if;
  raise notice 'PASS  姓名前後空白已修剪';

  -- 同一把冪等鍵重送：必須回同一筆，且不得新增資料
  v_result2 := public.mzsm_public_create_pilgrimage(
    '測試信眾甲', '0912345678', 2, 1, '測試備註', 'mzsm-test-pilgrim-0001');
  if v_result2 ->> 'code' <> v_code then
    raise exception 'FAIL: 冪等重送產生了不同報名碼 % vs %', v_result2 ->> 'code', v_code;
  end if;
  select count(*) into v_count from public.mzsm_pilgrimage;
  if v_count <> 1 then
    raise exception 'FAIL: 冪等重送建立了第二筆，目前 % 筆', v_count;
  end if;
  raise notice 'PASS  冪等重送回傳同一筆、未新增資料';

  -- 手機格式錯誤
  begin
    perform public.mzsm_public_create_pilgrimage('甲', 'abcd', 1, 0, '', 'mzsm-test-badphone-1');
    raise exception 'FAIL: 錯誤手機格式竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  手機格式錯誤被擋（22023）';
  end;

  -- 沒有任何參加者
  begin
    perform public.mzsm_public_create_pilgrimage('甲', '0912345678', 0, 0, '', 'mzsm-test-nobody-1');
    raise exception 'FAIL: 0 人報名竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  0 人報名被擋（22023）';
  end;

  -- 冪等鍵格式錯誤
  begin
    perform public.mzsm_public_create_pilgrimage('甲', '0912345678', 1, 0, '', 'short');
    raise exception 'FAIL: 過短的 idempotency_key 竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  idempotency_key 格式錯誤被擋（22023）';
  end;

  -- 正確查詢
  v_result := public.mzsm_public_lookup_pilgrimage(v_code, '5678');
  if v_result -> 'record' is null or v_result -> 'record' = 'null'::jsonb then
    raise exception 'FAIL: 正確末四碼查不到資料';
  end if;
  if (v_result -> 'record') ? 'phone' or (v_result -> 'record') ? 'name' then
    raise exception 'FAIL: 查詢結果洩漏姓名或手機：%', v_result;
  end if;
  raise notice 'PASS  查詢成功且未回傳姓名/手機：%', v_result -> 'record';

  -- 錯誤末四碼
  v_result := public.mzsm_public_lookup_pilgrimage(v_code, '0000');
  if v_result -> 'record' <> 'null'::jsonb then
    raise exception 'FAIL: 錯誤末四碼竟然查得到';
  end if;
  raise notice 'PASS  錯誤末四碼查無資料';

  -- ────────────────────────────────────────────────────────────
  raise notice '── 3. 查詢節流：同一組編碼連續失敗會被鎖 ──';
  -- ────────────────────────────────────────────────────────────
  -- 先清掉前面測試累積的失敗次數，這樣下面測的就是「剛好第 9 次」這個邊界
  delete from public.mzsm_lookup_attempts where scope = 'pilgrimage' and code = v_code;

  -- 第 1～8 次失敗查詢都必須還能查（回傳查無資料，不是被拒）
  for i in 1..8 loop
    v_result := public.mzsm_public_lookup_pilgrimage(v_code, '1111');
    if v_result -> 'record' <> 'null'::jsonb then
      raise exception 'FAIL: 第 % 次錯誤末四碼竟然查得到資料', i;
    end if;
  end loop;
  select failures into v_count from public.mzsm_lookup_attempts
   where scope = 'pilgrimage' and code = v_code and window_start = date_trunc('hour', now());
  if v_count <> 8 then
    raise exception 'FAIL: 失敗次數累計不正確，預期 8 實得 %', v_count;
  end if;
  raise notice 'PASS  前 8 次失敗查詢正常回應，計數累計為 8';

  -- 第 9 次必須被擋
  begin
    perform public.mzsm_public_lookup_pilgrimage(v_code, '1111');
    raise exception 'FAIL: 第 9 次失敗查詢仍被放行（可被暴力枚舉末四碼）';
  exception when sqlstate '22023' then
    raise notice 'PASS  第 9 次失敗查詢被節流擋下（22023）';
  end;

  -- 節流是「同一組編碼」而不是全站，別組編碼不該被牽連
  v_result := public.mzsm_public_lookup_pilgrimage('MSM-2026-9999', '1111');
  if v_result -> 'record' <> 'null'::jsonb then
    raise exception 'FAIL: 不存在的編碼竟然查得到';
  end if;
  raise notice 'PASS  節流只鎖被攻擊的那組編碼，其他編碼不受影響';

  -- ────────────────────────────────────────────────────────────
  raise notice '── 4. 點燈：建立、查詢、後台列表與樂觀鎖 ──';
  -- ────────────────────────────────────────────────────────────
  v_result := public.mzsm_public_create_light(
    '測試點燈信眾', '0987654321', '平安燈', '測試對象', '2000-01-01', '', 'mzsm-test-light-0001');
  v_code := v_result ->> 'code';
  if v_code !~ '^LMP-\d{4}-0001$' then
    raise exception 'FAIL: 點燈碼格式不符：%', v_code;
  end if;
  raise notice 'PASS  建立點燈 %（燈別 %）', v_code, v_result ->> 'type';

  -- 生日格式錯誤
  begin
    perform public.mzsm_public_create_light('甲', '0987654321', '平安燈', '對象', '2000/01/01', '', 'mzsm-test-badbirth-1');
    raise exception 'FAIL: 錯誤生日格式竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  生日格式錯誤被擋（22023）';
  end;

  -- 不存在的日期
  begin
    perform public.mzsm_public_create_light('甲', '0987654321', '平安燈', '對象', '2001-02-30', '', 'mzsm-test-nodate-1');
    raise exception 'FAIL: 不存在的日期 2001-02-30 竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  不存在的日期被擋（22023）';
  end;

  -- 未登入者呼叫後台函式
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.mzsm_admin_list_lights(50, null);
    raise exception 'FAIL: 未登入者竟然可以列出後台點燈資料';
  exception when insufficient_privilege then
    raise notice 'PASS  未登入呼叫後台被拒（42501）';
  end;

  -- 已登入但非管理者
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    perform public.mzsm_admin_list_lights(50, null);
    raise exception 'FAIL: 一般登入者竟然可以列出後台點燈資料';
  exception when insufficient_privilege then
    raise notice 'PASS  一般登入者呼叫後台被拒（42501）';
  end;

  -- 管理者
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.mzsm_admin_list_lights(50, null);
  if jsonb_array_length(v_result -> 'rows') <> 1 then
    raise exception 'FAIL: 後台點燈列表筆數不對：%', v_result;
  end if;
  if (v_result -> 'rows' -> 0) ? 'phone' then
    raise exception 'FAIL: 後台列表洩漏完整手機：%', v_result -> 'rows' -> 0;
  end if;
  if (v_result -> 'rows' -> 0) ->> 'phone_last4' <> '4321' then
    raise exception 'FAIL: 後台手機末四碼不正確：%', v_result -> 'rows' -> 0;
  end if;
  raise notice 'PASS  管理者可列出後台資料，只拿得到末四碼 %',
    (v_result -> 'rows' -> 0) ->> 'phone_last4';

  v_version := ((v_result -> 'rows' -> 0) ->> 'version')::integer;

  -- 正確版本更新
  v_result := public.mzsm_admin_update_light(v_code, v_version, '已確認', '已繳');
  if (v_result -> 'row' ->> 'status') <> '已確認' or (v_result -> 'row' ->> 'pay') <> '已繳' then
    raise exception 'FAIL: 後台更新結果不正確：%', v_result;
  end if;
  if ((v_result -> 'row' ->> 'version')::integer) <> v_version + 1 then
    raise exception 'FAIL: 版本沒有遞增：%', v_result;
  end if;
  raise notice 'PASS  後台更新成功，版本 % → %', v_version, v_result -> 'row' ->> 'version';

  -- 用舊版本再更新一次：必須衝突
  begin
    perform public.mzsm_admin_update_light(v_code, v_version, '待確認', null);
    raise exception 'FAIL: 舊版本竟然可以覆蓋（樂觀鎖失效）';
  exception when unique_violation then
    raise notice 'PASS  舊版本更新被擋（23505 版本衝突）';
  end;

  -- 不存在的 id
  begin
    perform public.mzsm_admin_update_light('LMP-2026-9999', 1, '已確認', null);
    raise exception 'FAIL: 不存在的點燈碼竟然更新成功';
  exception when sqlstate 'P0002' then
    raise notice 'PASS  不存在的點燈碼回傳查無資料（P0002）';
  end;

  -- 不允許的狀態值
  begin
    perform public.mzsm_admin_update_light(v_code, v_version + 1, '隨便寫', null);
    raise exception 'FAIL: 不允許的狀態值竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  不允許的狀態值被擋（22023）';
  end;

  -- ────────────────────────────────────────────────────────────
  raise notice '── 5. 安太歲 ──';
  -- ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', '', true);
  v_result := public.mzsm_public_create_taisui(
    '測試香客', '0911222333', '測試對象', '1990-06-15', '平安順遂', 'mzsm-test-taisui-0001');
  v_code := v_result ->> 'code';
  if v_code !~ '^PEA-\d{4}-0001$' then
    raise exception 'FAIL: 安太歲碼格式不符：%', v_code;
  end if;
  if v_result ->> 'lunar_status' <> 'pending_review' then
    raise exception 'FAIL: lunar_status 不是 pending_review：%', v_result;
  end if;
  raise notice 'PASS  建立安太歲 %（農曆待人工確認）', v_code;

  -- 安太歲生日為必填
  begin
    perform public.mzsm_public_create_taisui('甲', '0911222333', '對象', '', '', 'mzsm-test-taisui-nobirth');
    raise exception 'FAIL: 安太歲沒填生日竟然通過';
  exception when sqlstate '22023' then
    raise notice 'PASS  安太歲生日必填被強制（22023）';
  end;

  v_result := public.mzsm_public_lookup_taisui(v_code, '2333');
  if (v_result -> 'record') ? 'phone' or (v_result -> 'record') ? 'name' then
    raise exception 'FAIL: 安太歲查詢洩漏姓名或手機：%', v_result;
  end if;
  if (v_result -> 'record' ->> 'birth') <> '1990-06-15' then
    raise exception 'FAIL: 安太歲生日回傳不正確：%', v_result;
  end if;
  raise notice 'PASS  安太歲查詢正確且未洩漏個資';

  -- ────────────────────────────────────────────────────────────
  raise notice '── 6. 公告：草稿不外流、置頂排序、版本衝突 ──';
  -- ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_result := public.mzsm_admin_save_announcement('第一則公告', '內文一', 'published', false, null, null);
  if (v_result -> 'row' ->> 'id') !~ '^ANN-\d{4}-0001$' then
    raise exception 'FAIL: 公告編號格式不符：%', v_result -> 'row' ->> 'id';
  end if;
  v_code := v_result -> 'row' ->> 'id';
  v_version := (v_result -> 'row' ->> 'version')::integer;

  perform public.mzsm_admin_save_announcement('草稿公告', '不該被民眾看到', 'draft', false, null, null);
  perform public.mzsm_admin_save_announcement('置頂公告', '內文三', 'published', true, null, null);

  -- 民眾端：只能看到 published，且置頂在最前
  perform set_config('request.jwt.claim.sub', '', true);
  v_result := public.mzsm_public_list_announcements(20, null);
  if jsonb_array_length(v_result -> 'rows') <> 2 then
    raise exception 'FAIL: 民眾端看到 % 則公告（應為 2，草稿不得外流）',
      jsonb_array_length(v_result -> 'rows');
  end if;
  if (v_result -> 'rows' -> 0 ->> 'title') <> '置頂公告' then
    raise exception 'FAIL: 置頂公告沒有排在最前：%', v_result -> 'rows';
  end if;
  if exists (select 1 from jsonb_array_elements(v_result -> 'rows') e
             where e ->> 'title' = '草稿公告') then
    raise exception 'FAIL: 草稿公告外流給民眾';
  end if;
  raise notice 'PASS  民眾端只看到 2 則已發佈公告，置頂在最前，草稿未外流';

  -- 管理端看得到全部 3 則
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.mzsm_admin_list_announcements(20, null);
  if jsonb_array_length(v_result -> 'rows') <> 3 then
    raise exception 'FAIL: 管理端看到 % 則（應為 3）', jsonb_array_length(v_result -> 'rows');
  end if;
  raise notice 'PASS  管理端看得到全部 3 則（含草稿）';

  -- 版本衝突
  begin
    perform public.mzsm_admin_save_announcement('改標題', '改內文', 'published', false, v_code, v_version + 99);
    raise exception 'FAIL: 錯誤的 expected_version 竟然可以存檔';
  exception when unique_violation then
    raise notice 'PASS  公告版本衝突被擋（23505）';
  end;

  -- 正確版本可以存檔，版本遞增
  v_result := public.mzsm_admin_save_announcement('改後標題', '改後內文', 'published', false, v_code, v_version);
  if (v_result -> 'row' ->> 'version')::integer <> v_version + 1 then
    raise exception 'FAIL: 公告版本沒有遞增：%', v_result;
  end if;
  raise notice 'PASS  正確版本存檔成功，版本 % → %', v_version, v_result -> 'row' ->> 'version';

  -- 發佈後改回草稿，民眾端就看不到了
  perform public.mzsm_admin_save_announcement('改後標題', '改後內文', 'draft', false, v_code,
    (v_result -> 'row' ->> 'version')::integer);
  perform set_config('request.jwt.claim.sub', '', true);
  v_result := public.mzsm_public_list_announcements(20, null);
  if exists (select 1 from jsonb_array_elements(v_result -> 'rows') e where e ->> 'id' = v_code) then
    raise exception 'FAIL: 改回草稿後民眾端仍看得到';
  end if;
  raise notice 'PASS  改回草稿後民眾端立即看不到';

  -- 標題超長
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.mzsm_admin_save_announcement(repeat('字', 121), '內文', 'draft', false, null, null);
    raise exception 'FAIL: 121 字標題竟然通過（上限 120）';
  exception when sqlstate '22023' then
    raise notice 'PASS  標題長度上限被強制（22023）';
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice '';
  raise notice '════════ 全部通過 ════════';
end
$test$;
