-- MZSM 20260910：既有八表直接存取封鎖。狀態：NOT RUN。
-- Owner 在已核對的 Supabase SQL Editor 執行。缺表即中止，不猜測或重建正式結構。
-- 單一 transaction；失敗整筆回復。不刪任何宮務資料、不修改帳號名單。
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
declare t text; r text; rel oid;
begin
  foreach r in array array['anon','authenticated'] loop
    if not exists(select 1 from pg_roles where rolname=r and not rolsuper and not rolbypassrls) then
      raise exception 'MZSM_ROLE_GUARD: invalid application role %',r;
    end if;
  end loop;
  foreach t in array array['mzsm_counters','mzsm_admins','mzsm_announcements','mzsm_pilgrimage','mzsm_lights','mzsm_taisui','mzsm_idempotency','mzsm_lookup_attempts'] loop
    rel:=to_regclass(format('public.%I',t));
    if rel is null or not exists(select 1 from pg_class where oid=rel and relkind='r') then
      raise exception 'MZSM_SCHEMA_GUARD: missing or unexpected table %',t;
    end if;
  end loop;
end
$guard$;

alter table public.mzsm_counters enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_counters;
create policy mzsm_deny_direct on public.mzsm_counters
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_counters from public, anon, authenticated;

alter table public.mzsm_admins enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_admins;
create policy mzsm_deny_direct on public.mzsm_admins
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_admins from public, anon, authenticated;

alter table public.mzsm_announcements enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_announcements;
create policy mzsm_deny_direct on public.mzsm_announcements
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_announcements from public, anon, authenticated;

alter table public.mzsm_pilgrimage enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_pilgrimage;
create policy mzsm_deny_direct on public.mzsm_pilgrimage
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_pilgrimage from public, anon, authenticated;

alter table public.mzsm_lights enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_lights;
create policy mzsm_deny_direct on public.mzsm_lights
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_lights from public, anon, authenticated;

alter table public.mzsm_taisui enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_taisui;
create policy mzsm_deny_direct on public.mzsm_taisui
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_taisui from public, anon, authenticated;

alter table public.mzsm_idempotency enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_idempotency;
create policy mzsm_deny_direct on public.mzsm_idempotency
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_idempotency from public, anon, authenticated;

alter table public.mzsm_lookup_attempts enable row level security;
drop policy if exists mzsm_deny_direct on public.mzsm_lookup_attempts;
create policy mzsm_deny_direct on public.mzsm_lookup_attempts
  as restrictive for all to public using (false) with check (false);
revoke all privileges on table public.mzsm_lookup_attempts from public, anon, authenticated;

-- 表級 REVOKE 不會移除舊的欄位級授權；逐欄一併撤回直接存取權限。
do $columns$
declare t text; a record; r text; rel oid;
begin
  foreach t in array array['mzsm_counters','mzsm_admins','mzsm_announcements','mzsm_pilgrimage','mzsm_lights','mzsm_taisui','mzsm_idempotency','mzsm_lookup_attempts'] loop
    rel:=to_regclass(format('public.%I',t));
    for a in select attname from pg_attribute where attrelid=rel and attnum>0 and not attisdropped loop
      execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.%2$I from public, anon, authenticated',a.attname,t);
    end loop;
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r,rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(r,rel,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'MZSM_INHERITED_GRANT: remaining direct privilege on % for %; transaction aborted',t,r;
      end if;
    end loop;
  end loop;
end
$columns$;
commit;
