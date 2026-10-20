-- =====================================================================
-- SCHEMA.sql  —  Personal website (Supabase / PostgreSQL)
--
-- HOW TO USE: Supabase dashboard -> SQL Editor -> paste ALL of this -> Run.
-- It is safe to run again (idempotent).
--
-- This file contains NO content. Only structure, security policies,
-- and empty settings rows. All content is entered later from /admin.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Helper: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2) Staff (who may use the admin)
--    Roles: owner > admin > editor.
--    Rows are created by hand in the SQL Editor (see bootstrap at the bottom).
--    No API policy can insert/update/delete here on purpose.
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'editor')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and role = 'owner'
  );
$$;


-- ---------------------------------------------------------------------
-- 3) Site settings (one row per key, value is JSON)
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  value      jsonb not null default '{}'::jsonb check (pg_column_size(value) < 100000),
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4) Pages
-- ---------------------------------------------------------------------
create table if not exists public.pages (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                     and char_length(slug) <= 60
                     and slug not in ('admin', 'api', 'ar', 'en')),
  title       jsonb not null default '{}'::jsonb,
  seo         jsonb not null default '{}'::jsonb,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  show_in_nav boolean not null default false,
  nav_order   integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (pg_column_size(title) < 4000 and pg_column_size(seo) < 20000)
);


-- ---------------------------------------------------------------------
-- 5) Blocks (the building pieces of a page)
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null references public.pages (id) on delete cascade,
  type       text not null check (type ~ '^[a-z][a-z0-9_]{1,39}$'),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blocks_page_sort_idx on public.blocks (page_id, sort_order);


-- ---------------------------------------------------------------------
-- 6) Media (files stored in the Storage bucket "media")
-- ---------------------------------------------------------------------
create table if not exists public.media (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique check (char_length(path) <= 300),
  mime_type  text not null
             check (mime_type in ('image/jpeg', 'image/png', 'image/webp',
                                  'image/avif', 'image/gif', 'application/pdf')),
  size_bytes integer not null check (size_bytes >= 0 and size_bytes <= 10485760),
  width      integer check (width is null or width > 0),
  height     integer check (height is null or height > 0),
  alt        jsonb not null default '{}'::jsonb check (pg_column_size(alt) < 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 7) Audit log (who changed what, and when) — filled automatically
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
begin
  if tg_op = 'DELETE' then
    rec := to_jsonb(old);
  else
    rec := to_jsonb(new);
  end if;

  insert into public.audit_log (user_id, action, entity, entity_id)
  values (auth.uid(), tg_op, tg_table_name, coalesce(rec ->> 'id', rec ->> 'key'));

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 8) Triggers
-- ---------------------------------------------------------------------
drop trigger if exists trg_site_settings_updated on public.site_settings;
create trigger trg_site_settings_updated
  before update on public.site_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pages_updated on public.pages;
create trigger trg_pages_updated
  before update on public.pages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_blocks_updated on public.blocks;
create trigger trg_blocks_updated
  before update on public.blocks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_site_settings_audit on public.site_settings;
create trigger trg_site_settings_audit
  after insert or update or delete on public.site_settings
  for each row execute function public.log_change();

drop trigger if exists trg_pages_audit on public.pages;
create trigger trg_pages_audit
  after insert or update or delete on public.pages
  for each row execute function public.log_change();

drop trigger if exists trg_blocks_audit on public.blocks;
create trigger trg_blocks_audit
  after insert or update or delete on public.blocks
  for each row execute function public.log_change();

drop trigger if exists trg_media_audit on public.media;
create trigger trg_media_audit
  after insert or update or delete on public.media
  for each row execute function public.log_change();


-- ---------------------------------------------------------------------
-- 9) Row Level Security (RLS) — ON for every table
-- ---------------------------------------------------------------------
alter table public.admin_users   enable row level security;
alter table public.site_settings enable row level security;
alter table public.pages         enable row level security;
alter table public.blocks        enable row level security;
alter table public.media         enable row level security;
alter table public.audit_log     enable row level security;

-- admin_users: a logged-in user may read ONLY their own row. No writes via API.
drop policy if exists "admin_users: read own row" on public.admin_users;
create policy "admin_users: read own row"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

-- site_settings: public read; only admin/owner may write. (Never store secrets here.)
drop policy if exists "site_settings: public read" on public.site_settings;
create policy "site_settings: public read"
  on public.site_settings for select to anon, authenticated
  using (true);

drop policy if exists "site_settings: admin insert" on public.site_settings;
create policy "site_settings: admin insert"
  on public.site_settings for insert to authenticated
  with check (public.is_admin());

drop policy if exists "site_settings: admin update" on public.site_settings;
create policy "site_settings: admin update"
  on public.site_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- pages: public sees published only; staff sees everything; admin may delete (never "home").
drop policy if exists "pages: read" on public.pages;
create policy "pages: read"
  on public.pages for select to anon, authenticated
  using (status = 'published' or public.is_staff());

drop policy if exists "pages: staff insert" on public.pages;
create policy "pages: staff insert"
  on public.pages for insert to authenticated
  with check (public.is_staff());

drop policy if exists "pages: staff update" on public.pages;
create policy "pages: staff update"
  on public.pages for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "pages: admin delete" on public.pages;
create policy "pages: admin delete"
  on public.pages for delete to authenticated
  using (public.is_admin() and slug <> 'home');

-- blocks: public sees visible blocks of published pages; staff sees and edits all.
drop policy if exists "blocks: read" on public.blocks;
create policy "blocks: read"
  on public.blocks for select to anon, authenticated
  using (
    public.is_staff()
    or (
      is_visible
      and exists (
        select 1 from public.pages p
        where p.id = blocks.page_id and p.status = 'published'
      )
    )
  );

drop policy if exists "blocks: staff insert" on public.blocks;
create policy "blocks: staff insert"
  on public.blocks for insert to authenticated
  with check (public.is_staff());

drop policy if exists "blocks: staff update" on public.blocks;
create policy "blocks: staff update"
  on public.blocks for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "blocks: staff delete" on public.blocks;
create policy "blocks: staff delete"
  on public.blocks for delete to authenticated
  using (public.is_staff());

-- media: public read (files are public anyway); staff writes.
drop policy if exists "media: public read" on public.media;
create policy "media: public read"
  on public.media for select to anon, authenticated
  using (true);

drop policy if exists "media: staff insert" on public.media;
create policy "media: staff insert"
  on public.media for insert to authenticated
  with check (public.is_staff());

drop policy if exists "media: staff update" on public.media;
create policy "media: staff update"
  on public.media for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "media: staff delete" on public.media;
create policy "media: staff delete"
  on public.media for delete to authenticated
  using (public.is_staff());

-- audit_log: admin/owner may read. Nobody writes via API (triggers do it).
drop policy if exists "audit_log: admin read" on public.audit_log;
create policy "audit_log: admin read"
  on public.audit_log for select to authenticated
  using (public.is_admin());


-- ---------------------------------------------------------------------
-- 10) Explicit privileges (least privilege; RLS still applies on top)
--     If you ever see "permission denied for table", check this section.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.site_settings, public.pages, public.blocks, public.media to anon;

grant select, insert, update, delete on public.pages, public.blocks, public.media to authenticated;
grant select, insert, update on public.site_settings to authenticated;
grant select on public.admin_users, public.audit_log to authenticated;

grant execute on function public.is_staff(), public.is_admin(), public.is_owner()
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11) Storage bucket "media" (public files, strict limits, NO svg)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media bucket: public read" on storage.objects;
create policy "media bucket: public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');

drop policy if exists "media bucket: staff insert" on storage.objects;
create policy "media bucket: staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_staff());

drop policy if exists "media bucket: staff update" on storage.objects;
create policy "media bucket: staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_staff())
  with check (bucket_id = 'media' and public.is_staff());

drop policy if exists "media bucket: staff delete" on storage.objects;
create policy "media bucket: staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_staff());


-- ---------------------------------------------------------------------
-- 12) Structural rows ONLY (no content): empty settings + the home page shell
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value) values
  ('general', '{}'::jsonb),
  ('theme',   '{}'::jsonb),
  ('nav',     '{}'::jsonb),
  ('footer',  '{}'::jsonb),
  ('seo',     '{}'::jsonb)
on conflict (key) do nothing;

insert into public.pages (slug, title, status)
values ('home', '{}'::jsonb, 'draft')
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------
-- 13) BOOTSTRAP THE OWNER (run this SEPARATELY, after creating your user)
--     1. Supabase -> Authentication -> Users -> Add user (your email + strong password).
--     2. Replace the email below with YOUR email, remove the leading "--", and run it:
-- ---------------------------------------------------------------------
-- insert into public.admin_users (user_id, role)
-- select id, 'owner' from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL'
-- on conflict (user_id) do update set role = 'owner';


-- ---------------------------------------------------------------------
-- 14) VERIFY (optional): every table below must show rowsecurity = true
-- ---------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

