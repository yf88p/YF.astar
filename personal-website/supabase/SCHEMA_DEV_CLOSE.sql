-- =====================================================================
-- SCHEMA_DEV_CLOSE.sql  —  removes everything SCHEMA_DEV_OPEN.sql added
--
-- Run it BEFORE the login system goes live (see AUTH_LATER.md).
-- After it, only the owner/staff rules of SCHEMA.sql remain.
-- It is safe to run again (idempotent).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Drop the temporary policies
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: pages select"        on public.pages;
drop policy if exists "dev_open: pages insert"        on public.pages;
drop policy if exists "dev_open: pages update"        on public.pages;
drop policy if exists "dev_open: pages delete"        on public.pages;

drop policy if exists "dev_open: blocks select"       on public.blocks;
drop policy if exists "dev_open: blocks insert"       on public.blocks;
drop policy if exists "dev_open: blocks update"       on public.blocks;
drop policy if exists "dev_open: blocks delete"       on public.blocks;

drop policy if exists "dev_open: media insert"        on public.media;
drop policy if exists "dev_open: media update"        on public.media;
drop policy if exists "dev_open: media delete"        on public.media;

drop policy if exists "dev_open: settings insert"     on public.site_settings;
drop policy if exists "dev_open: settings update"     on public.site_settings;

drop policy if exists "dev_open: audit select"        on public.audit_log;

drop policy if exists "dev_open: media bucket insert" on storage.objects;
drop policy if exists "dev_open: media bucket update" on storage.objects;
drop policy if exists "dev_open: media bucket delete" on storage.objects;


-- ---------------------------------------------------------------------
-- 2) Take the extra privileges back from anon
--    (anon keeps the read-only grants that SCHEMA.sql gave it)
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.pages, public.blocks, public.media from anon;
revoke insert, update on public.site_settings from anon;
revoke select on public.audit_log from anon;


-- ---------------------------------------------------------------------
-- 3) VERIFY (run it): must return ZERO rows
-- ---------------------------------------------------------------------
select schemaname, tablename, policyname
from pg_policies
where policyname like 'dev_open:%'
order by 1, 2, 3;

