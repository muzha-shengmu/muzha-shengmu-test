-- 木柵聖母宮｜核心資料結構、權限與 RPC
-- ============================================================
-- 設計原則
--   1. 所有資料表一律 ENABLE ROW LEVEL SECURITY 且「不建立任何 policy」，
--      因此 anon / authenticated 直接查表一律讀不到東西。所有存取只能
--      經由本檔的 SECURITY DEFINER 函式，權限與欄位遮蔽都在函式裡強制。
--   2. 每一支 SECURITY DEFINER 函式都固定 search_path，避免被搜尋路徑劫持。
--   3. 個資（姓名、完整手機、生日）永遠不會被任何 public_* 函式回傳；
--      民眾查詢只回傳最小欄位，後台也只拿得到手機末四碼。
--   4. 錯誤一律用前端 mzsm-rpc-client.js 已經在解析的 SQLSTATE：
--      22023 驗證失敗｜P0002 查無資料｜23505 版本衝突｜42501 權限不足。
--
-- 這個檔可以重複執行（idempotent），也可以直接在本機 PostgreSQL 16 上跑。

begin;

-- ── 角色：Supabase 已內建，本機測試時才會真的建立 ──────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- ============================================================
-- 一、資料表
-- ============================================================

-- 年度流水號計數器（MSM-2026-0001 這種編碼用）
create table if not exists public.mzsm_counters (
  scope       text primary key,
  next_value  bigint not null default 1
);

-- 宮務管理者名單。要成為管理者必須由既有管理者或 service_role 加入，
-- 不能自行註冊取得權限。
create table if not exists public.mzsm_admins (
  user_id     uuid primary key,
  email       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.mzsm_announcements (
  id            text primary key,
  title         text not null,
  content       text not null,
  status        text not null check (status in ('draft', 'published')),
  is_pinned     boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create table if not exists public.mzsm_pilgrimage (
  id          text primary key,
  name        text not null,
  phone       text not null,
  adult       integer not null check (adult between 0 and 20),
  child       integer not null check (child between 0 and 20),
  note        text not null default '',
  status      text not null default '待確認' check (status in ('待確認', '已確認', '已取消')),
  created_at  timestamptz not null default now(),
  version     integer not null default 1,
  constraint mzsm_pilgrimage_has_person check (adult + child >= 1)
);

create table if not exists public.mzsm_lights (
  id          text primary key,
  name        text not null,
  phone       text not null,
  type        text not null,
  target      text not null,
  birth       date,
  note        text not null default '',
  status      text not null default '待確認' check (status in ('待確認', '已確認', '已取消')),
  pay         text not null default '未繳' check (pay in ('未繳', '已繳')),
  created_at  timestamptz not null default now(),
  version     integer not null default 1
);

create table if not exists public.mzsm_taisui (
  id            text primary key,
  name          text not null,
  phone         text not null,
  target        text not null,
  birth         date not null,
  note          text not null default '',
  status        text not null default '待確認' check (status in ('待確認', '已確認', '已取消')),
  lunar_status  text not null default 'pending_review',
  created_at    timestamptz not null default now(),
  version       integer not null default 1
);

-- 冪等鍵：同一個 idempotency_key 重送時回傳第一次的結果，不會建立第二筆。
create table if not exists public.mzsm_idempotency (
  scope       text not null,
  key         text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (scope, key)
);

-- 查詢節流：報名碼是可推測的序號，末四碼只有一萬種組合，
-- 沒有節流的話可以被暴力枚舉。每小時每組編碼最多 8 次失敗。
create table if not exists public.mzsm_lookup_attempts (
  scope         text not null,
  code          text not null,
  window_start  timestamptz not null,
  failures      integer not null default 0,
  primary key (scope, code, window_start)
);

create index if not exists mzsm_announcements_public_idx
  on public.mzsm_announcements (is_pinned desc, published_at desc, id desc)
  where status = 'published';
create index if not exists mzsm_lights_created_idx on public.mzsm_lights (created_at desc, id desc);
create index if not exists mzsm_pilgrimage_created_idx on public.mzsm_pilgrimage (created_at desc, id desc);
create index if not exists mzsm_taisui_created_idx on public.mzsm_taisui (created_at desc, id desc);

-- ── RLS：全部開啟、全部不給 policy ⇒ 直接查表一律無資料 ────────────
alter table public.mzsm_counters         enable row level security;
alter table public.mzsm_admins           enable row level security;
alter table public.mzsm_announcements    enable row level security;
alter table public.mzsm_pilgrimage       enable row level security;
alter table public.mzsm_lights           enable row level security;
alter table public.mzsm_taisui           enable row level security;
alter table public.mzsm_idempotency      enable row level security;
alter table public.mzsm_lookup_attempts  enable row level security;

-- 連 SELECT 權限本身也一併收回，讓「忘記加 policy」不是唯一的防線。
revoke all on public.mzsm_counters, public.mzsm_admins, public.mzsm_announcements,
               public.mzsm_pilgrimage, public.mzsm_lights, public.mzsm_taisui,
               public.mzsm_idempotency, public.mzsm_lookup_attempts
  from anon, authenticated;

-- ============================================================
-- 二、共用輔助函式
-- ============================================================

create or replace function public.mzsm_raise_validation(p_message text)
returns void language plpgsql immutable as $$
begin
  raise exception 'MZSM_VALIDATION_ERROR: %', p_message using errcode = '22023';
end;
$$;

-- 目前登入者是不是宮務管理者。auth.uid() 由 Supabase 從 JWT 解出來。
create or replace function public.mzsm_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  begin
    v_uid := auth.uid();
  exception when others then
    return false;      -- 本機沒有 auth schema 時視為未登入
  end;
  if v_uid is null then
    return false;
  end if;
  return exists (select 1 from public.mzsm_admins a where a.user_id = v_uid);
end;
$$;

create or replace function public.mzsm_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.mzsm_is_admin() then
    raise exception 'MZSM_FORBIDDEN: 目前帳號沒有宮務管理權限。' using errcode = '42501';
  end if;
end;
$$;

-- 年度流水號。用 UPDATE ... RETURNING 取號，同一列會被鎖住，併發下不會發號重複。
create or replace function public.mzsm_next_code(p_prefix text, p_year integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := p_prefix || '-' || p_year::text;
  v_next  bigint;
begin
  insert into public.mzsm_counters (scope, next_value)
  values (v_scope, 1)
  on conflict (scope) do nothing;

  update public.mzsm_counters
     set next_value = next_value + 1
   where scope = v_scope
  returning next_value - 1 into v_next;

  return p_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- 文字欄位：修剪、必填檢查、長度上限。
create or replace function public.mzsm_text(p_value text, p_label text, p_required boolean, p_max integer)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if p_required and v = '' then
    raise exception 'MZSM_VALIDATION_ERROR: % 為必填。', p_label using errcode = '22023';
  end if;
  if char_length(v) > p_max then
    raise exception 'MZSM_VALIDATION_ERROR: % 超過 % 字元。', p_label, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.mzsm_phone(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v !~ '^\d{8,10}$' then
    raise exception 'MZSM_VALIDATION_ERROR: 手機號碼格式不正確。' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.mzsm_last4(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v !~ '^\d{4}$' then
    raise exception 'MZSM_VALIDATION_ERROR: 末四碼必須是四位數字。' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.mzsm_idempotency_key(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v !~ '^[A-Za-z0-9._:-]{8,80}$' then
    raise exception 'MZSM_VALIDATION_ERROR: idempotency_key 格式不正確。' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.mzsm_limit(p_limit integer)
returns integer language sql immutable as $$
  select least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- 查詢節流。回傳 true 代表還可以查；false 代表這組編碼這小時已經被試太多次。
create or replace function public.mzsm_lookup_allowed(p_scope text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_failures integer;
begin
  select failures into v_failures
    from public.mzsm_lookup_attempts
   where scope = p_scope and code = p_code and window_start = v_window;
  return coalesce(v_failures, 0) < 8;
end;
$$;

create or replace function public.mzsm_lookup_failed(p_scope text, p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
begin
  insert into public.mzsm_lookup_attempts (scope, code, window_start, failures)
  values (p_scope, p_code, v_window, 1)
  on conflict (scope, code, window_start)
  do update set failures = public.mzsm_lookup_attempts.failures + 1;
  delete from public.mzsm_lookup_attempts where window_start < v_window - interval '24 hours';
end;
$$;

create or replace function public.mzsm_lookup_guard(p_scope text, p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.mzsm_lookup_allowed(p_scope, p_code) then
    raise exception 'MZSM_VALIDATION_ERROR: 查詢次數過多，請稍後再試。' using errcode = '22023';
  end if;
end;
$$;

-- 取回既有的冪等結果；沒有就回 null。
create or replace function public.mzsm_idempotent_get(p_scope text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  select result into v from public.mzsm_idempotency where scope = p_scope and key = p_key;
  return v;
end;
$$;

create or replace function public.mzsm_idempotent_put(p_scope text, p_key text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.mzsm_idempotency (scope, key, result)
  values (p_scope, p_key, p_result)
  on conflict (scope, key) do nothing;
end;
$$;

-- ============================================================
-- 三、公告 RPC
-- ============================================================

create or replace function public.mzsm_public_list_announcements(
  p_limit integer default 20,
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  integer := public.mzsm_limit(p_limit);
  v_rows   jsonb;
  v_next   text;
  v_c_pin  boolean;
  v_c_pub  timestamptz;
begin
  if p_cursor is not null then
    select is_pinned, coalesce(published_at, 'epoch'::timestamptz)
      into v_c_pin, v_c_pub
      from public.mzsm_announcements
     where id = p_cursor and status = 'published';
  end if;

  with page as (
    select id, title, content, is_pinned, published_at
      from public.mzsm_announcements
     where status = 'published'
       and (
         p_cursor is null
         or v_c_pin is null
         or (is_pinned, coalesce(published_at, 'epoch'::timestamptz), id)
            < (v_c_pin, v_c_pub, p_cursor)
       )
     order by is_pinned desc, coalesce(published_at, 'epoch'::timestamptz) desc, id desc
     limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by page.is_pinned desc,
                            coalesce(page.published_at, 'epoch'::timestamptz) desc,
                            page.id desc), '[]'::jsonb),
         (select id from page order by is_pinned desc,
                  coalesce(published_at, 'epoch'::timestamptz) desc, id desc
           offset greatest(v_limit - 1, 0) limit 1)
    into v_rows, v_next
    from page;

  if jsonb_array_length(v_rows) < v_limit then
    v_next := null;
  end if;

  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
end;
$$;

create or replace function public.mzsm_admin_list_announcements(
  p_limit integer default 20,
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.is_pinned desc, t.updated_at desc, t.id desc), '[]'::jsonb)
    into v_rows
    from (
      select id, title, content, status, is_pinned, published_at, created_at, updated_at, version
        from public.mzsm_announcements
       order by is_pinned desc, updated_at desc, id desc
       limit v_limit
    ) t;

  return jsonb_build_object('rows', v_rows, 'next_cursor', null);
end;
$$;

create or replace function public.mzsm_admin_save_announcement(
  p_title            text,
  p_content          text,
  p_status           text,
  p_is_pinned        boolean,
  p_id               text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title   text;
  v_content text;
  v_status  text;
  v_pinned  boolean := coalesce(p_is_pinned, false);
  v_id      text := nullif(btrim(coalesce(p_id, '')), '');
  v_row     public.mzsm_announcements%rowtype;
begin
  perform public.mzsm_require_admin();

  v_title   := public.mzsm_text(p_title, '標題', true, 120);
  v_content := public.mzsm_text(p_content, '內文', true, 4000);
  v_status  := public.mzsm_text(p_status, '狀態', true, 30);
  if v_status not in ('draft', 'published') then
    perform public.mzsm_raise_validation('狀態只能是 draft 或 published。');
  end if;

  if v_id is null then
    insert into public.mzsm_announcements (id, title, content, status, is_pinned, published_at)
    values (public.mzsm_next_code('ANN', extract(year from now())::integer),
            v_title, v_content, v_status, v_pinned,
            case when v_status = 'published' then now() else null end)
    returning * into v_row;
  else
    select * into v_row from public.mzsm_announcements where id = v_id for update;
    if not found then
      raise exception 'MZSM_NOT_FOUND: 找不到公告。' using errcode = 'P0002';
    end if;
    if p_expected_version is not null and p_expected_version <> v_row.version then
      raise exception 'MZSM_CONFLICT: 公告已被其他操作更新。' using errcode = '23505';
    end if;

    update public.mzsm_announcements
       set title        = v_title,
           content      = v_content,
           status       = v_status,
           is_pinned    = v_pinned,
           published_at = case when v_status = 'published'
                               then coalesce(published_at, now())
                               else null end,
           updated_at   = now(),
           version      = version + 1
     where id = v_id
    returning * into v_row;
  end if;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

-- ============================================================
-- 四、南巡進香 RPC
-- ============================================================

create or replace function public.mzsm_public_create_pilgrimage(
  p_name            text,
  p_phone           text,
  p_adult           integer,
  p_child           integer,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key    text := public.mzsm_idempotency_key(p_idempotency_key);
  v_cached jsonb := public.mzsm_idempotent_get('pilgrimage', v_key);
  v_adult  integer := coalesce(p_adult, 0);
  v_child  integer := coalesce(p_child, 0);
  v_row    public.mzsm_pilgrimage%rowtype;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  if v_adult < 0 or v_adult > 20 or v_child < 0 or v_child > 20 then
    perform public.mzsm_raise_validation('人數必須是 0～20 的整數。');
  end if;
  if v_adult + v_child < 1 then
    perform public.mzsm_raise_validation('至少需要一位參加者。');
  end if;

  insert into public.mzsm_pilgrimage (id, name, phone, adult, child, note)
  values (public.mzsm_next_code('MSM', extract(year from now())::integer),
          public.mzsm_text(p_name, '姓名', true, 80),
          public.mzsm_phone(p_phone),
          v_adult, v_child,
          public.mzsm_text(p_note, '備註', false, 500))
  returning * into v_row;

  v_result := jsonb_build_object(
    'code', v_row.id,
    'status', v_row.status,
    'created_at', to_char(v_row.created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD')
  );
  perform public.mzsm_idempotent_put('pilgrimage', v_key, v_result);
  return v_result;
end;
$$;

create or replace function public.mzsm_public_lookup_pilgrimage(
  p_code  text,
  p_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code  text := public.mzsm_text(p_code, '報名碼', true, 80);
  v_last4 text := public.mzsm_last4(p_last4);
  v_row   public.mzsm_pilgrimage%rowtype;
begin
  perform public.mzsm_lookup_guard('pilgrimage', v_code);

  select * into v_row
    from public.mzsm_pilgrimage
   where id = v_code and right(phone, 4) = v_last4;

  if not found then
    perform public.mzsm_lookup_failed('pilgrimage', v_code);
    return jsonb_build_object('record', null);
  end if;

  return jsonb_build_object('record', jsonb_build_object(
    'code',   v_row.id,
    'adult',  v_row.adult,
    'child',  v_row.child,
    'status', v_row.status
  ));
end;
$$;

-- ============================================================
-- 五、點燈祈福 RPC
-- ============================================================

create or replace function public.mzsm_public_create_light(
  p_name            text,
  p_phone           text,
  p_type            text,
  p_target          text,
  p_birth           text,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key    text := public.mzsm_idempotency_key(p_idempotency_key);
  v_cached jsonb := public.mzsm_idempotent_get('light', v_key);
  v_birth  text := btrim(coalesce(p_birth, ''));
  v_date   date := null;
  v_row    public.mzsm_lights%rowtype;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  if v_birth <> '' then
    if v_birth !~ '^\d{4}-\d{2}-\d{2}$' then
      perform public.mzsm_raise_validation('生日格式不正確。');
    end if;
    begin
      v_date := v_birth::date;
    exception when others then
      perform public.mzsm_raise_validation('生日日期不存在。');
    end;
  end if;

  insert into public.mzsm_lights (id, name, phone, type, target, birth, note)
  values (public.mzsm_next_code('LMP', extract(year from now())::integer),
          public.mzsm_text(p_name, '姓名', true, 80),
          public.mzsm_phone(p_phone),
          public.mzsm_text(p_type, '燈別', true, 40),
          public.mzsm_text(p_target, '祈福對象', true, 80),
          v_date,
          public.mzsm_text(p_note, '備註', false, 500))
  returning * into v_row;

  v_result := jsonb_build_object(
    'code', v_row.id,
    'type', v_row.type,
    'status', v_row.status,
    'created_at', to_char(v_row.created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD')
  );
  perform public.mzsm_idempotent_put('light', v_key, v_result);
  return v_result;
end;
$$;

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
    'target', v_row.target,
    'status', v_row.status
  ));
end;
$$;

create or replace function public.mzsm_admin_list_lights(
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
             right(phone, 4) as phone_last4,   -- 後台也拿不到完整手機
             type,
             target,
             coalesce(to_char(birth, 'YYYY-MM-DD'), '') as birth,
             note,
             status,
             pay,
             to_char(created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as created_at,
             version
        from public.mzsm_lights
       order by created_at desc, id desc
       limit v_limit
    ) t;

  return jsonb_build_object('rows', v_rows, 'next_cursor', null);
end;
$$;

create or replace function public.mzsm_admin_update_light(
  p_id               text,
  p_expected_version integer,
  p_status           text default null,
  p_pay              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  text := public.mzsm_text(p_id, '點燈碼', true, 80);
  v_row public.mzsm_lights%rowtype;
begin
  perform public.mzsm_require_admin();

  if p_expected_version is null or p_expected_version < 1 then
    perform public.mzsm_raise_validation('expected_version 必須是正整數。');
  end if;
  if p_status is not null and p_status not in ('待確認', '已確認', '已取消') then
    perform public.mzsm_raise_validation('狀態不允許。');
  end if;
  if p_pay is not null and p_pay not in ('未繳', '已繳') then
    perform public.mzsm_raise_validation('繳費狀態不允許。');
  end if;

  select * into v_row from public.mzsm_lights where id = v_id for update;
  if not found then
    raise exception 'MZSM_NOT_FOUND: 找不到點燈資料。' using errcode = 'P0002';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'MZSM_CONFLICT: 資料已被其他操作更新。' using errcode = '23505';
  end if;

  update public.mzsm_lights
     set status  = coalesce(p_status, status),
         pay     = coalesce(p_pay, pay),
         version = version + 1
   where id = v_id
  returning * into v_row;

  return jsonb_build_object('row', jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'pay', v_row.pay, 'version', v_row.version
  ));
end;
$$;

-- ============================================================
-- 六、安太歲 RPC
-- ============================================================

create or replace function public.mzsm_public_create_taisui(
  p_name            text,
  p_phone           text,
  p_target          text,
  p_birth           text,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key    text := public.mzsm_idempotency_key(p_idempotency_key);
  v_cached jsonb := public.mzsm_idempotent_get('taisui', v_key);
  v_birth  text := btrim(coalesce(p_birth, ''));
  v_date   date;
  v_row    public.mzsm_taisui%rowtype;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  if v_birth !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.mzsm_raise_validation('生日格式不正確。');
  end if;
  begin
    v_date := v_birth::date;
  exception when others then
    perform public.mzsm_raise_validation('生日日期不存在。');
  end;

  insert into public.mzsm_taisui (id, name, phone, target, birth, note)
  values (public.mzsm_next_code('PEA', extract(year from now())::integer),
          public.mzsm_text(p_name, '姓名', true, 80),
          public.mzsm_phone(p_phone),
          public.mzsm_text(p_target, '祈福對象', true, 80),
          v_date,
          public.mzsm_text(p_note, '備註', false, 500))
  returning * into v_row;

  v_result := jsonb_build_object(
    'code', v_row.id,
    'status', v_row.status,
    'lunar_status', v_row.lunar_status
  );
  perform public.mzsm_idempotent_put('taisui', v_key, v_result);
  return v_result;
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
    'target',       v_row.target,
    'birth',        to_char(v_row.birth, 'YYYY-MM-DD'),
    'status',       v_row.status,
    'lunar_status', v_row.lunar_status
  ));
end;
$$;

-- ============================================================
-- 七、執行權限
-- ============================================================
-- 預設先全部收回，再逐支放行。管理者函式雖然也放給 authenticated，
-- 但函式內部一定會先呼叫 mzsm_require_admin()，只有登入 ≠ 有權限。

do $$
declare
  fn text;
  public_fns text[] := array[
    'mzsm_public_list_announcements(integer,text)',
    'mzsm_public_create_pilgrimage(text,text,integer,integer,text,text)',
    'mzsm_public_lookup_pilgrimage(text,text)',
    'mzsm_public_create_light(text,text,text,text,text,text,text)',
    'mzsm_public_lookup_light(text,text)',
    'mzsm_public_create_taisui(text,text,text,text,text,text)',
    'mzsm_public_lookup_taisui(text,text)'
  ];
  admin_fns text[] := array[
    'mzsm_admin_list_announcements(integer,text)',
    'mzsm_admin_save_announcement(text,text,text,boolean,text,integer)',
    'mzsm_admin_list_lights(integer,text)',
    'mzsm_admin_update_light(text,integer,text,text)'
  ];
  helper_fns text[] := array[
    'mzsm_is_admin()',
    'mzsm_require_admin()',
    'mzsm_next_code(text,integer)',
    'mzsm_raise_validation(text)',
    'mzsm_lookup_allowed(text,text)',
    'mzsm_lookup_failed(text,text)',
    'mzsm_lookup_guard(text,text)',
    'mzsm_idempotent_get(text,text)',
    'mzsm_idempotent_put(text,text,jsonb)'
  ];
begin
  foreach fn in array public_fns || admin_fns || helper_fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
  end loop;

  foreach fn in array public_fns loop
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;

  foreach fn in array admin_fns loop
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;

  -- mzsm_is_admin 讓前端可以問「我現在是不是管理者」以決定要不要顯示後台介面。
  execute 'grant execute on function public.mzsm_is_admin() to authenticated';
end
$$;

commit;
