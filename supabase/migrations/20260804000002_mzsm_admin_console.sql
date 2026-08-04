-- 木柵聖母宮｜補上進香與安太歲的宮務後台 RPC
-- ============================================================
-- 第一份 migration 只給了點燈後台（list/update），進香與安太歲的報名
-- 宮方看不到也改不了，等於收得到資料卻無法作業。這裡補齊。
--
-- 與點燈後台同樣的規則：
--   * 一律先 mzsm_require_admin()
--   * 只回傳手機末四碼，不回傳完整號碼
--   * 更新一律走 expected_version 樂觀鎖

begin;

create or replace function public.mzsm_admin_list_pilgrimage(
  p_limit  integer default 20,
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := public.mzsm_limit(p_limit);
  v_rows  jsonb;
begin
  perform public.mzsm_require_admin();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
    into v_rows
    from (
      select id,
             name,
             right(phone, 4) as phone_last4,
             adult,
             child,
             note,
             status,
             to_char(created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as created_at,
             version
        from public.mzsm_pilgrimage
       order by created_at desc, id desc
       limit v_limit
    ) t;

  return jsonb_build_object('rows', v_rows, 'next_cursor', null);
end;
$$;

create or replace function public.mzsm_admin_update_pilgrimage(
  p_id               text,
  p_expected_version integer,
  p_status           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  text := public.mzsm_text(p_id, '報名碼', true, 80);
  v_row public.mzsm_pilgrimage%rowtype;
begin
  perform public.mzsm_require_admin();

  if p_expected_version is null or p_expected_version < 1 then
    perform public.mzsm_raise_validation('expected_version 必須是正整數。');
  end if;
  if p_status is not null and p_status not in ('待確認', '已確認', '已取消') then
    perform public.mzsm_raise_validation('狀態不允許。');
  end if;

  select * into v_row from public.mzsm_pilgrimage where id = v_id for update;
  if not found then
    raise exception 'MZSM_NOT_FOUND: 找不到報名資料。' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'MZSM_CONFLICT: 資料已被其他操作更新。' using errcode = '23505';
  end if;

  update public.mzsm_pilgrimage
     set status = coalesce(p_status, status),
         version = version + 1
   where id = v_id
  returning * into v_row;

  return jsonb_build_object('row', jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'version', v_row.version
  ));
end;
$$;

create or replace function public.mzsm_admin_list_taisui(
  p_limit  integer default 20,
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := public.mzsm_limit(p_limit);
  v_rows  jsonb;
begin
  perform public.mzsm_require_admin();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
    into v_rows
    from (
      select id,
             name,
             right(phone, 4) as phone_last4,
             target,
             to_char(birth, 'YYYY-MM-DD') as birth,
             note,
             status,
             lunar_status,
             to_char(created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as created_at,
             version
        from public.mzsm_taisui
       order by created_at desc, id desc
       limit v_limit
    ) t;

  return jsonb_build_object('rows', v_rows, 'next_cursor', null);
end;
$$;

create or replace function public.mzsm_admin_update_taisui(
  p_id               text,
  p_expected_version integer,
  p_status           text default null,
  p_lunar_status     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  text := public.mzsm_text(p_id, '安太歲碼', true, 80);
  v_row public.mzsm_taisui%rowtype;
begin
  perform public.mzsm_require_admin();

  if p_expected_version is null or p_expected_version < 1 then
    perform public.mzsm_raise_validation('expected_version 必須是正整數。');
  end if;
  if p_status is not null and p_status not in ('待確認', '已確認', '已取消') then
    perform public.mzsm_raise_validation('狀態不允許。');
  end if;
  -- 農曆核對狀態：pending_review 待核對／confirmed 已核對
  if p_lunar_status is not null and p_lunar_status not in ('pending_review', 'confirmed') then
    perform public.mzsm_raise_validation('農曆核對狀態不允許。');
  end if;

  select * into v_row from public.mzsm_taisui where id = v_id for update;
  if not found then
    raise exception 'MZSM_NOT_FOUND: 找不到安太歲資料。' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'MZSM_CONFLICT: 資料已被其他操作更新。' using errcode = '23505';
  end if;

  update public.mzsm_taisui
     set status       = coalesce(p_status, status),
         lunar_status = coalesce(p_lunar_status, lunar_status),
         version      = version + 1
   where id = v_id
  returning * into v_row;

  return jsonb_build_object('row', jsonb_build_object(
    'id', v_row.id, 'status', v_row.status,
    'lunar_status', v_row.lunar_status, 'version', v_row.version
  ));
end;
$$;

do $$
declare
  fn text;
  admin_fns text[] := array[
    'mzsm_admin_list_pilgrimage(integer,text)',
    'mzsm_admin_update_pilgrimage(text,integer,text)',
    'mzsm_admin_list_taisui(integer,text)',
    'mzsm_admin_update_taisui(text,integer,text,text)'
  ];
begin
  foreach fn in array admin_fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

commit;
