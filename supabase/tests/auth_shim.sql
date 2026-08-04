-- 本機測試用的 auth.uid() 替身
-- ============================================================
-- Supabase 正式環境本來就有 auth schema 與 auth.uid()（從 JWT 解出 sub）。
-- 本機沒有，所以測試前先建一個行為相同的替身：讀 request.jwt.claim.sub。
--
-- **這個檔只給本機測試用，絕對不要套用到 Supabase 專案上。**
-- 正式環境套用它會覆蓋掉 Supabase 自己的 auth.uid()。
-- 因此它放在 supabase/tests/ 而不是 supabase/migrations/。

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
