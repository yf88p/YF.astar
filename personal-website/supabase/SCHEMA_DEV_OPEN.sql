-- =====================================================================
-- SCHEMA_DEV_OPEN.sql  —  TEMPORARY, TEST PROJECT ONLY
--
-- WHAT IT DOES: lets the public (anon) key read AND write content, so the
-- admin works without a login. After running it, ANYONE who has your public
-- anon key can change the site. Use it only in a throwaway Supabase project
-- with no real or private data.
--
-- ORDER: run SCHEMA.sql first, then this file.
-- UNDO:  run SCHEMA_DEV_CLOSE.sql (before the login system goes live).
-- It is safe to run again (idempotent).
--
-- The "home" page can still never be deleted.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Privileges for the anon role (RLS policies below still decide rows)
-- ---------------------------------------------------------------------
grant insert, update, delete on public.pages, public.blocks, public.media to anon;
grant insert, update on public.site_settings to anon;
grant select on public.audit_log to anon;


-- ---------------------------------------------------------------------
-- 2) pages
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: pages select" on public.pages;
create policy "dev_open: pages select"
  on public.pages for select to anon, authenticated
  using (true);

drop policy if exists "dev_open: pages insert" on public.pages;
create policy "dev_open: pages insert"
  on public.pages for insert to anon, authenticated
  with check (true);

drop policy if exists "dev_open: pages update" on public.pages;
create policy "dev_open: pages update"
  on public.pages for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "dev_open: pages delete" on public.pages;
create policy "dev_open: pages delete"
  on public.pages for delete to anon, authenticated
  using (slug <> 'home');


-- ---------------------------------------------------------------------
-- 3) blocks
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: blocks select" on public.blocks;
create policy "dev_open: blocks select"
  on public.blocks for select to anon, authenticated
  using (true);

drop policy if exists "dev_open: blocks insert" on public.blocks;
create policy "dev_open: blocks insert"
  on public.blocks for insert to anon, authenticated
  with check (true);

drop policy if exists "dev_open: blocks update" on public.blocks;
create policy "dev_open: blocks update"
  on public.blocks for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "dev_open: blocks delete" on public.blocks;
create policy "dev_open: blocks delete"
  on public.blocks for delete to anon, authenticated
  using (true);


-- ---------------------------------------------------------------------
-- 4) media rows (select is already public in SCHEMA.sql)
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: media insert" on public.media;
create policy "dev_open: media insert"
  on public.media for insert to anon, authenticated
  with check (true);

drop policy if exists "dev_open: media update" on public.media;
create policy "dev_open: media update"
  on public.media for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "dev_open: media delete" on public.media;
create policy "dev_open: media delete"
  on public.media for delete to anon, authenticated
  using (true);


-- ---------------------------------------------------------------------
-- 5) site_settings (select is already public in SCHEMA.sql)
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: settings insert" on public.site_settings;
create policy "dev_open: settings insert"
  on public.site_settings for insert to anon, authenticated
  with check (true);

drop policy if exists "dev_open: settings update" on public.site_settings;
create policy "dev_open: settings update"
  on public.site_settings for update to anon, authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------
-- 6) audit_log (read only; the triggers still write it)
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: audit select" on public.audit_log;
create policy "dev_open: audit select"
  on public.audit_log for select to anon, authenticated
  using (true);


-- ---------------------------------------------------------------------
-- 7) Storage bucket "media" (files)
-- ---------------------------------------------------------------------
drop policy if exists "dev_open: media bucket insert" on storage.objects;
create policy "dev_open: media bucket insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media');

drop policy if exists "dev_open: media bucket update" on storage.objects;
create policy "dev_open: media bucket update"
  on storage.objects for update to anon, authenticated
  using (bucket_id = 'media')
  with check (bucket_id = 'media');

drop policy if exists "dev_open: media bucket delete" on storage.objects;
create policy "dev_open: media bucket delete"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'media');


-- ---------------------------------------------------------------------
-- 8) VERIFY (optional): lists the temporary policies that now exist
-- ---------------------------------------------------------------------
-- select schemaname, tablename, policyname from pg_policies where policyname like 'dev_open:%' order by 1, 2, 3;

