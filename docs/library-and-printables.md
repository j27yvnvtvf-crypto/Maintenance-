# Document library & printable formats (Phase 1)

Phase 1 of the operations-center plan
(`plan-expansion-centro-operaciones.md`, sections 2 "Biblioteca" and
3 "Formatos") built on top of access model v2 (Phase 0). This document
records what exists, how permissions work, how to configure each
environment, and what is still pending.

## What was implemented

### Document library

- **Data model** (migration `20261103220000_library_documents.sql`,
  additive only):
  - `documents` — category (`sop_greystar`, `procedimiento_interno`,
    `manual_fabricante`, `sds`, `emergencia`, `formulario`, `otro`),
    clearly distinguished type (`official` / `internal_guide` / `draft`),
    title, optional SOP number, responsible owner (a team member) and
    status (`draft` / `published` / `archived`).
  - `document_versions` — one row per version: version number, effective /
    revision date, change note, file metadata. Versions are append-only:
    a new version never overwrites the previous row or its file bytes.
  - `document_reads` — one confirmation per (version, member): who
    confirmed reading WHICH version, and when. Evidence of reading —
    never presented as verification of compliance.
  - `admin_audit_log` gains the document actions (`create_document`,
    `update_document`, `publish_document`, `archive_document`,
    `add_document_version`), so library administration is part of the
    Phase 0 audit trail.
- **Private files**: the migration creates the Supabase Storage bucket
  `documents` with `public = false`. There is no public URL for any file.
  Uploads and downloads happen only in server routes after a permission
  check; downloads redirect to a signed URL valid for 120 seconds.
  No document content is ever committed to this repository.
- **API** (`/api/library`, `/api/library/download`): every request
  re-reads the account state from the database (Phase 0 gate) before
  anything else.
- **UI**: "Library / Biblioteca" tab in the dashboard — search, category
  filter (plus status filter for the administrator), version history,
  per-version download, read confirmation, and the read-evidence view
  (who read / who has not) for the administrator.

### Permission matrix (server + database, not just UI)

| Action | Pending / rejected / suspended / revoked | Approved (any job title) | Administrator |
| --- | --- | --- | --- |
| List / view published documents | **403 — nothing** | Yes | Yes |
| View draft or archived documents | 403 | **No (invisible)** | Yes |
| Download a published version | 403 | Yes (signed URL, 120 s) | Yes |
| Download a draft/archived version | 403 | **403** | Yes |
| Confirm reading a published version | 403 | Yes | Yes |
| See who read / who has not | 403 | No | Yes |
| Create / edit / publish / archive / new version | 403 | **403** | Yes (audited) |

The pure decision rules live in `lib/library-rules.ts` and mirror
`lib/access-rules.ts`; `job_title` and the legacy `role` are never inputs.

### Printable formats (US Letter)

Route `/print/<format>` renders a clean Letter sheet (The Darley header,
format title, folio, generation timestamp, page numbers in the `@page`
footer). Open it from the Library tab and use the phone browser's
Print / Save-as-PDF.

| # | Format | Route | State |
| --- | --- | --- | --- |
| 1 | Daily Assignment Sheet | `/print/daily-assignments?date=YYYY-MM-DD` | **Connected to real data**: work orders due (incl. overdue) grouped by assignee, plus the day's completions |
| 2 | Weekly Maintenance Plan | `/print/weekly-plan?week=YYYY-MM-DD` | **Connected to real data**: work orders by due day (Mon–Sun) + weekly load per team member |
| 3 | Pending Parts & Vendor Log | `/print/pending-parts-vendors` | Structured paper template — connects when the vendors module lands (Phase 3) |
| 4 | Inventory Reorder List | `/print/inventory-reorder` | Structured paper template (includes the SOP 5025 color legend) — connects with inventory (Phase 3) |
| 5 | Shop Closing Checklist | `/print/shop-closing` | Structured paper template — connects with the shop module (Phase 3) |
| 6 | Training & Safety Meeting Log | `/print/training-log` | Structured paper template — connects with training records (Phase 3); its "documents / SOP versions reviewed" line matches the library's read confirmations |

Formats with data (1–2) are approved-accounts-only, like all property
data. The four templates intentionally have **no** in-app data capture in
this phase, so nothing gets typed twice when their modules arrive.

## Configuration per environment

1. Apply the migrations in order, including
   `20261103213000_access_model_v2.sql` (Phase 0) and
   `20261103220000_library_documents.sql` (Phase 1). The Phase 1 migration
   itself creates the storage bucket — no manual bucket setup is needed.
2. Verify in Supabase: Storage shows a **private** bucket named
   `documents`; the tables `documents`, `document_versions` and
   `document_reads` exist with RLS enabled and no anon/authenticated
   grants.
3. No new environment variables are required: uploads/downloads use the
   existing server-side Supabase configuration.

## How to test

- **As administrator**: Library tab → New document (upload a file, leave
  it as draft) → it is visible only to you → Publish → New version
  (upload a second file) → version history shows both, v1 still
  downloadable → Archive → it disappears for the team. Check the Team
  tab's administrative history for the document actions.
- **As an approved account**: only published documents are listed;
  download works; "I confirm I read this version" records the
  confirmation and the administrator sees it (and who has not read it).
  Trying to open a draft's download link returns 403.
- **As a pending account**: `/api/library` returns 403 and the print
  formats show only the access notice — no list, no data.

## Verification performed

- `pnpm verify:library` — 11/11: decision tests for the permission
  matrix above (including agreement with `lib/access-rules.ts` on every
  account state) plus static contract tests over the shipped source
  (private bucket, deny-by-default RLS, append-only versions, signed-URL
  downloads, audited actions, no seeded content, six print formats).
- `pnpm verify:access` — 13/13 (Phase 0 suite still green).
- `pnpm build`, `pnpm typecheck`, `pnpm lint` — pass.
  (In this sandbox pnpm itself is unavailable; the equivalent
  `node_modules/.bin` binaries were invoked directly.)

## Limitations & pending (real)

- **The library starts EMPTY on purpose.** No real SOP, manual or SDS is
  included: official documents must be provided by Jose (the
  administrator) and uploaded through the admin flow. Nothing in this
  phase invents Greystar policy text. No seed/example document is
  inserted by the migration or the code.
- **End-to-end tests against a live Supabase are PENDING**: a real file
  round-trip (upload → signed-URL download), pending-account 403s over
  HTTP, and read-confirmation persistence need the disposable staging
  Supabase project that the Phase 0 E2E harness
  (`scripts/e2e-access-model.mjs`) is also waiting for. Decision-level
  and contract-level verification is done; HTTP-level verification is
  not claimed.
- File size limit is 25 MB per version; allowed types are PDF, common
  images and Office documents. Very large manufacturer manuals may need
  the limit revisited.
- Read confirmations are recorded per version; when a new version is
  published, the team must confirm the new version — the administrator
  view shows exactly who is missing.
