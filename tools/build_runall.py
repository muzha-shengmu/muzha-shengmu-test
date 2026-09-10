#!/usr/bin/env python3
"""Combine the four migrations into one self-guarding script.

Three separate pastes is a lot to ask of someone doing this on a phone. This
produces one paste that checks for a conflicting schema first and aborts the
whole transaction if it finds one, so the safety the preflight provided is kept
without needing a human to read a report between steps.

The inner begin/commit of each migration is stripped and replaced with a single
outer transaction, so any failure anywhere rolls the entire thing back.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase/RUN_ALL.sql"

MIGRATIONS = [
    "supabase/migrations/20260804000001_mzsm_core.sql",
    "supabase/migrations/20260804000002_mzsm_admin_console.sql",
    "supabase/migrations/20260910000001_mzsm_deny_direct.sql",
    "supabase/migrations/20260910000002_mzsm_public_lookup_privacy.sql",
]


def strip_tx(sql: str) -> str:
    """Remove the file's own begin;/commit; — one outer transaction wraps all."""
    sql = re.sub(r"^\s*begin\s*;\s*$", "", sql, flags=re.M | re.I)
    sql = re.sub(r"^\s*commit\s*;\s*$", "", sql, flags=re.M | re.I)
    return sql.strip()


GUARD = """-- ============================================================
-- 木柵聖母宮｜一次套用（含自動安全檢查）
-- ============================================================
-- 這一份把「事前檢查 + 四份 migration」合併成一次執行。
--
--   * 全部包在同一個交易裡：任何一步失敗，整份回滾，資料庫維持原狀。
--   * 開頭會先檢查「有沒有同名但結構不同的舊資料表」。有的話立刻中止，
--     並印出是哪張表少了哪個欄位，不會動到你任何既有資料。
--   * 此守門只檢查部分欄位，不能證明完整相容；正式重跑須先比對完整結構及備份。
--
-- 本檔為 L3 候選，不是執行授權。正式專案目前 HOLD，不得直接貼上執行。
-- 成功時最後一列會顯示「✅ 完成」與各項數量。
-- ============================================================

begin;

do $mzsm_guard$
declare
  v_bad text;
begin
  select string_agg(format('  · %s 缺少欄位 %s', tbl, col), E'\\n' order by tbl, col)
    into v_bad
  from (
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
  ) as expected(tbl, col)
  where exists (
          select 1 from pg_tables
           where schemaname = 'public' and tablename = expected.tbl)
    and not exists (
          select 1 from information_schema.columns c
           where c.table_schema = 'public'
             and c.table_name = expected.tbl
             and c.column_name = expected.col);

  if v_bad is not null then
    raise exception E'中止：專案裡已經有同名但結構不同的資料表。\\n%\\n\\n沒有任何東西被修改。請把這段訊息回報，先決定舊表要改名保留還是刪除。', v_bad;
  end if;
end
$mzsm_guard$;

"""

SUMMARY = """
-- ── 完成摘要 ────────────────────────────────────────────────
select
  '✅ 完成'                                                        as "結果",
  (select count(*) from pg_tables
    where schemaname='public' and tablename like 'mzsm%')          as "資料表",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'mzsm%')           as "函式",
  (select count(*) from public.mzsm_admins)                        as "管理者",
  (select count(*) from public.mzsm_announcements)                 as "公告",
  (select count(*) from public.mzsm_lights)                        as "點燈",
  (select count(*) from public.mzsm_pilgrimage)                    as "進香",
  (select count(*) from public.mzsm_taisui)                        as "安太歲";
"""

parts = [GUARD]
for i, rel in enumerate(MIGRATIONS, 1):
    body = strip_tx((ROOT / rel).read_text(encoding="utf-8"))
    parts.append(f"-- ══════ 第 {i} 份：{pathlib.PurePosixPath(rel).name} ══════\n\n{body}\n")
parts.append("commit;\n")
parts.append(SUMMARY)

OUT.write_text("\n".join(parts), encoding="utf-8")
text = OUT.read_text(encoding="utf-8")
print(f"{OUT}")
print(f"  {text.count(chr(10))+1} 行 / {len(text)} 字元")
n_begin = len(re.findall(r"(?mi)^\s*begin\s*;", text))
n_commit = len(re.findall(r"(?mi)^\s*commit\s*;", text))
print(f"  begin 出現 {n_begin} 次（應為 1）")
print(f"  commit 出現 {n_commit} 次（應為 1）")
