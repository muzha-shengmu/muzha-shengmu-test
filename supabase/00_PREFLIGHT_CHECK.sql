-- 木柵聖母宮｜事前檢查（唯讀，不會改動任何東西）
-- ============================================================
-- 專案 mzsm-temple 建立於 2026-07-21，可能已經有先前留下的內容。
-- **在執行任何 migration 之前，先在 SQL Editor 貼上這一整份並 Run。**
--
-- 這份只做 SELECT，不建立、不修改、不刪除任何資料表或資料。
-- 執行後看最後一行的判定：
--   ✅ 可以直接執行 migration
--   ⚠️ 已經裝好了，重跑也安全（資料不會消失）
--   ❌ 有同名但結構不同的表，直接執行會失敗 —— 先把結果整份回報

select '── 1. 已存在的 mzsm_ 資料表 ──' as "檢查項目";

select
  tablename                                        as "資料表",
  (select count(*) from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.tablename) as "欄位數",
  case when rowsecurity then 'RLS 已開啟' else '⚠ RLS 未開啟' end   as "列級安全"
from pg_tables t
where schemaname = 'public' and tablename like 'mzsm%'
order by tablename;

select '── 2. 已存在的 mzsm_ 函式 ──' as "檢查項目";

select
  p.proname                                    as "函式",
  pg_get_function_identity_arguments(p.oid)    as "參數"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mzsm%'
order by p.proname;

select '── 3. 現有資料筆數（有資料代表已經在用，不可清空）──' as "檢查項目";

do $$
declare
  t record;
  n bigint;
  out_text text := '';
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename like 'mzsm%'
     order by tablename
  loop
    execute format('select count(*) from public.%I', t.tablename) into n;
    out_text := out_text || t.tablename || ' = ' || n || ' 筆；';
  end loop;
  if out_text = '' then
    raise notice '目前沒有任何 mzsm_ 資料表（全新專案）';
  else
    raise notice '%', out_text;
  end if;
end
$$;

select '── 4. 結構相容性判定 ──' as "檢查項目";

-- 逐一比對每張表「migration 需要的關鍵欄位」是否都在。
-- 只要有一張表存在卻少了關鍵欄位，直接執行 migration 就會失敗。
with expected(tbl, col) as (
  values
    ('mzsm_announcements','id'),      ('mzsm_announcements','title'),
    ('mzsm_announcements','content'), ('mzsm_announcements','status'),
    ('mzsm_announcements','is_pinned'),('mzsm_announcements','published_at'),
    ('mzsm_announcements','created_at'),('mzsm_announcements','updated_at'),
    ('mzsm_announcements','version'),
    ('mzsm_lights','id'),    ('mzsm_lights','name'),   ('mzsm_lights','phone'),
    ('mzsm_lights','type'),  ('mzsm_lights','target'), ('mzsm_lights','birth'),
    ('mzsm_lights','note'),  ('mzsm_lights','status'), ('mzsm_lights','pay'),
    ('mzsm_lights','created_at'), ('mzsm_lights','version'),
    ('mzsm_pilgrimage','id'),   ('mzsm_pilgrimage','name'),  ('mzsm_pilgrimage','phone'),
    ('mzsm_pilgrimage','adult'),('mzsm_pilgrimage','child'), ('mzsm_pilgrimage','note'),
    ('mzsm_pilgrimage','status'),('mzsm_pilgrimage','created_at'),('mzsm_pilgrimage','version'),
    ('mzsm_taisui','id'),    ('mzsm_taisui','name'),   ('mzsm_taisui','phone'),
    ('mzsm_taisui','target'),('mzsm_taisui','birth'),  ('mzsm_taisui','note'),
    ('mzsm_taisui','status'),('mzsm_taisui','lunar_status'),
    ('mzsm_taisui','created_at'), ('mzsm_taisui','version'),
    ('mzsm_admins','user_id'), ('mzsm_admins','email'),
    ('mzsm_counters','scope'), ('mzsm_counters','next_value'),
    ('mzsm_idempotency','scope'), ('mzsm_idempotency','key'), ('mzsm_idempotency','result'),
    ('mzsm_lookup_attempts','scope'), ('mzsm_lookup_attempts','code'),
    ('mzsm_lookup_attempts','window_start'), ('mzsm_lookup_attempts','failures')
)
select
  e.tbl                            as "資料表",
  e.col                            as "缺少的欄位",
  '❌ 同名表結構不符'               as "問題"
from expected e
where exists (select 1 from pg_tables where schemaname='public' and tablename = e.tbl)
  and not exists (
    select 1 from information_schema.columns c
     where c.table_schema='public' and c.table_name = e.tbl and c.column_name = e.col
  )
order by e.tbl, e.col;

select '── 5. 最終判定 ──' as "檢查項目";

with existing as (
  select count(*) as n from pg_tables
   where schemaname='public' and tablename like 'mzsm%'
),
expected(tbl, col) as (
  values
    ('mzsm_announcements','version'), ('mzsm_lights','version'),
    ('mzsm_lights','created_at'),     ('mzsm_pilgrimage','version'),
    ('mzsm_taisui','lunar_status'),   ('mzsm_admins','user_id'),
    ('mzsm_counters','next_value'),   ('mzsm_idempotency','result'),
    ('mzsm_lookup_attempts','failures')
),
mismatch as (
  select count(*) as n from expected e
   where exists (select 1 from pg_tables where schemaname='public' and tablename = e.tbl)
     and not exists (select 1 from information_schema.columns c
                      where c.table_schema='public' and c.table_name=e.tbl and c.column_name=e.col)
),
fns as (
  select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
   where n2.nspname='public' and p.proname like 'mzsm_public_%'
)
select
  case
    when (select n from mismatch) > 0 then
      '❌ 有同名但結構不同的資料表。直接執行 migration 會失敗（會整份回滾，不會弄壞現有資料）。請把上面第 4 節的結果整份回報，先決定要改名保留還是刪除舊表。'
    when (select n from existing) = 0 then
      '✅ 全新專案，沒有任何 mzsm_ 物件。可以直接依序執行兩份 migration。'
    when (select n from fns) >= 7 then
      '⚠️ 這個專案已經裝好了（資料表與函式都在）。重跑 migration 是安全的：實測過資料筆數與內容完全不變，只會把函式更新成最新版。若只是要更新程式，重跑即可。'
    else
      '⚠️ 有 mzsm_ 資料表但函式不完整（可能上次執行到一半）。重跑兩份 migration 即可補齊，現有資料不會被刪除。'
  end as "判定";
