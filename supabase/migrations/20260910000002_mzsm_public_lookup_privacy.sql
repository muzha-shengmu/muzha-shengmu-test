-- 只替換兩個既有查詢函式的公開回傳欄位；不改資料。NOT RUN。
begin;
set local lock_timeout='5s';
do $guard$
begin
  if to_regprocedure('public.mzsm_public_lookup_light(text,text)') is null
     or to_regprocedure('public.mzsm_public_lookup_taisui(text,text)') is null then
    raise exception 'MZSM_SCHEMA_GUARD: existing lookup functions required; do not create with default grants';
  end if;
end
$guard$;
create or replace function public.mzsm_public_lookup_light(
  p_code  text,
  p_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code  text := public.mzsm_text(p_code, '點燈碼', true, 80);
  v_last4 text := public.mzsm_last4(p_last4);
  v_row   public.mzsm_lights%rowtype;
begin
  perform public.mzsm_lookup_guard('light', v_code);

  select * into v_row
    from public.mzsm_lights
   where id = v_code and right(phone, 4) = v_last4;

  if not found then
    perform public.mzsm_lookup_failed('light', v_code);
    return jsonb_build_object('record', null);
  end if;

  return jsonb_build_object('record', jsonb_build_object(
    'code',   v_row.id,
    'type',   v_row.type,
    'status', v_row.status
  ));
end;
$$;

create or replace function public.mzsm_public_lookup_taisui(
  p_code  text,
  p_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code  text := public.mzsm_text(p_code, '安太歲碼', true, 80);
  v_last4 text := public.mzsm_last4(p_last4);
  v_row   public.mzsm_taisui%rowtype;
begin
  perform public.mzsm_lookup_guard('taisui', v_code);

  select * into v_row
    from public.mzsm_taisui
   where id = v_code and right(phone, 4) = v_last4;

  if not found then
    perform public.mzsm_lookup_failed('taisui', v_code);
    return jsonb_build_object('record', null);
  end if;

  return jsonb_build_object('record', jsonb_build_object(
    'code',         v_row.id,
    'status',       v_row.status,
    'lunar_status', v_row.lunar_status
  ));
end;
$$;
commit;
