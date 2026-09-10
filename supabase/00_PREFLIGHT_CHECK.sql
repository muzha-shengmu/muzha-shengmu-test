-- 木柵聖母宮｜事前檢查（唯讀，不會改動任何東西）
-- ============================================================
-- 專案 mzsm-temple 建立於 2026-07-21，可能已經有先前留下的內容。
-- **在執行任何 migration 之前，先在 SQL Editor 貼上這一整份並 Run。**
--
-- 這份只讀取目錄及資料筆數，包含 SELECT 與唯讀 DO 區塊；不修改資料。
-- 執行後看最後一行的判定：
--   此檢查不核發 migration 授權。任何結果都必須配合完整差異、備份與人工確認。

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
    raise notice 'public schema 未找到 mzsm_ 資料表；不代表整個專案為空。';
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

-- 目錄盤點不是相容性或授權證明；不以部分欄位與函式數推論可安全重跑。
select 'HOLD：本次只完成 public schema 的 mzsm_ 目錄與關鍵欄位盤點。尚未驗證其他 schema、完整欄位型別、約束、索引、觸發器、函式內容、權限、備份與還原；不可依本報告直接執行 migration。' as "判定";
