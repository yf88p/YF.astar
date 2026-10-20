# PROGRESS

## Current phase
Phase 3 — Media library (implemented; runtime acceptance pending the Supabase project choice)

## Verification (Phase 3)
- `npm run lint` — pass; `npx tsc --noEmit` — pass; `service_role` appears nowhere.
- Runtime acceptance (phone-gallery upload, 3 MB photo compressing to ~100–500 KB WebP, SVG/>10 MB rejection with Arabic message, delete removing file+row) needs a running Supabase test project with SCHEMA + DEV_OPEN applied and `.env.local` filled — the project choice from the previous message is still open, and no SQL was run on any existing project.
- Added allowed package: `browser-image-compression` (RULES.md section 2).

## Verification (Phase 2)
- `npm run lint` — pass; `npx tsc --noEmit` — pass
- `npm run build` — still unverifiable in the agent sandbox (no outbound access to `fonts.googleapis.com`, as in Phase 1); owner-side build required.
- Code checks: `service_role` appears nowhere; `ADMIN_MODE` is referenced only in `src/lib/admin-mode.ts`, `src/components/admin/AdminLocked.tsx`, `src/components/admin/DevBanner.tsx`, and `src/app/api/revalidate/route.ts` (the R9 files; the admin layout only renders those components).
- Runtime acceptance (locked vs open banner/dashboard counts, revalidate 403 from another origin and when locked) needs the owner's Supabase test project and `.env.local`.

## Verification (Phase 1)
- `npm run lint` — pass
- `npx tsc --noEmit` — pass
- `npm run build` — could NOT be verified in the agent sandbox: the sandbox has no outbound access to `fonts.googleapis.com`, so `next/font/google` (required by DESIGN.md section 3) cannot be fetched there. The owner must run `npm run build` locally or on Vercel to confirm. No code deviation was made for this sandbox limitation.
- Remaining acceptance items (locale redirect, RTL/LTR, theme toggle without flash, empty state, radius/density via dev tools) need the owner-side build/run to check.

## Decisions made
- Project location: new subfolder `personal-website/` inside the current repository (recommended option in Phase 0; owner replied "كامل" to continue).
- Next.js 16.4.2 installed, so the locale redirect file is `src/proxy.ts` (Next 16 convention, per RULES.md N7).
- Tailwind CSS v4 (installer default); globals.css starts with the v4 import.

## Files created
- Scaffold: package.json, package-lock.json, tsconfig.json, eslint config, postcss config, .gitignore
- next.config.ts, vercel.json, .env.example
- supabase/SCHEMA.sql, supabase/SCHEMA_DEV_OPEN.sql, supabase/SCHEMA_DEV_CLOSE.sql (unchanged copies)
- src/proxy.ts
- src/app/globals.css
- src/app/(site)/[locale]/layout.tsx, src/app/(site)/[locale]/page.tsx
- src/components/site/EmptyState.tsx, ThemeToggle.tsx, LocaleSwitcher.tsx
- src/lib/i18n.ts, safe-href.ts, admin-mode.ts, supabase/public.ts, supabase/browser.ts
- src/messages/ar.json, en.json
- PROGRESS.md

## Phase 2 files created
- src/messages/admin.ts
- src/components/admin/AdminLocked.tsx, DevBanner.tsx, Shell.tsx, Dashboard.tsx, AdminEmpty.tsx
- src/app/(admin)/admin/layout.tsx, page.tsx, pages/page.tsx (empty state stub until Phase 5), media/page.tsx (stub until Phase 3), settings/page.tsx (stub until Phase 4), tools/page.tsx and audit/page.tsx (empty states until Phases 8/9)
- src/app/api/revalidate/route.ts (open-mode version), src/app/api/keepalive/route.ts
- src/lib/revalidate-client.ts

## Phase 3 files created
- src/components/admin/MediaLibrary.tsx (upload with validation + client compression and progress, thumbnail grid, alt-text edit ar/en, confirmed delete of file+row)
- src/components/admin/MediaPicker.tsx (reusable picker dialog)
- src/components/admin/media-shared.ts (media row type, allowlist/size validation per RULES 5.6, fetch/upload/alt/delete helpers; SVG rejected, `<uuid>.<ext>` storage names, width/height stored)

## Open questions
- Which Supabase project is the test project for this site (new dedicated project recommended) — asked and still unanswered. No SQL has been run on any existing project.

## Temporary decisions (open admin mode — remove in the Auth phase)
- All open-mode code is confined to the R9 files: `src/lib/admin-mode.ts`, `src/components/admin/DevBanner.tsx`, `src/components/admin/AdminLocked.tsx`, and the open branch in `src/app/api/revalidate/route.ts`. The admin layout references none of it directly; it only renders DevBanner/AdminLocked. Pages/media/settings routes are empty-state stubs until their own phases.
