-- ============================================================
-- 木柵聖母宮｜把某個帳號設為宮務管理者
-- ============================================================
-- 前置：先在 Supabase 後台 Authentication → Users → Add user
--       建立帳號（記得勾 Auto Confirm User）。
--
-- 然後把下面這一行的信箱改成你剛建立的那個，再整份執行。
-- 不需要手抄 UID，這份會自己從 auth.users 查出來。
--
-- 可重複執行：同一個帳號跑第二次不會重複新增。
-- ============================================================

do $mzsm_admin$
declare
  -- ↓↓↓ 只要改這一行 ↓↓↓
  v_email text := 'mj29379898@gmail.com';
  -- ↑↑↑ 只要改這一行 ↑↑↑
  v_uid   uuid;
  v_count integer;
begin
  select id into v_uid from auth.users where lower(email) = lower(btrim(v_email));

  if v_uid is null then
    raise exception E'找不到帳號：%\n\n請先到 Authentication → Users → Add user 建立這個信箱的帳號（記得勾 Auto Confirm User），再回來執行這一份。', v_email;
  end if;

  -- 帳號被刪除重建後 UID 會變，舊的那筆會變成指向不存在的帳號。
  -- 留著不會造成安全問題（已刪除的帳號登不進來），但會讓管理者名單看起來
  -- 有兩個人，日後盤點時容易誤判，所以在這裡一併清掉。
  delete from public.mzsm_admins a
   where not exists (select 1 from auth.users u where u.id = a.user_id);

  insert into public.mzsm_admins (user_id, email)
  values (v_uid, lower(btrim(v_email)))
  on conflict (user_id) do update set email = excluded.email;

  select count(*) into v_count from public.mzsm_admins;
  raise notice '已將 % 設為宮務管理者；目前共 % 位。', v_email, v_count;
end
$mzsm_admin$;

-- 確認結果
select email as "管理者信箱", user_id as "帳號 UID", created_at as "加入時間"
  from public.mzsm_admins
 order by created_at;
