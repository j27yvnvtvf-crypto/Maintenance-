# Centro de Operaciones de The Darley (Phase 5)

Phase 5 turns the work-order registry into the daily operations center:
structured job fields (record type, origin, building/unit), differentiated
hold states with mandatory follow-up data, closings that demand a recorded
verification, vendor visits as records of their own, job quotes with
quoted / authorized / real cost kept separate, a unified photo gallery, and
the daily KPI summary. Golden rule: nothing automatic completes a job — not
a date, not a part arriving, not a vendor visit, not a note's wording. Only
a recorded closing that passes `validateClose` (`lib/jobs-rules.ts`) does.

Two verification layers exist, like the earlier phases:

- **Decision + static contract suite** — `scripts/verify-centro.mjs`
  (runs anywhere with `pnpm verify:centro`). Imports the production rules
  from `lib/jobs-rules.ts` / `lib/notes-rules.ts` and scans the Phase 5
  migration for its structural guarantees.
- **End-to-end suite** — `scripts/e2e-centro.mjs`. Drives a real staging
  deployment over HTTP with real accounts. Its checks are **PENDING** until
  it runs green against the disposable staging project; nothing here claims
  otherwise.

## What `scripts/e2e-centro.mjs` covers

The suite signs in as the staging admin (env-provided), signs up two test
accounts through the app's own sign-up flow, approves one of them through
the real API and leaves the other pending, then runs 13 numbered checks:

1. **Pending isolation** — pending `GET /api/dashboard` is not `approved`
   with `jobs=[]`; `GET /api/centro`, `/api/visits`, `/api/photos` and
   `/api/quotes` each return 403.
2. **Structured creation** — an approved user creates a job
   (`create_job`, `recordType: 'work_order'`, building `2000`, unit `204`,
   origin `rmm_audit`) and the response echoes the new fields.
3. **Hold gate** — `update_job` to `waiting_parts` with no hold fields is
   400 `HOLD_FIELDS_REQUIRED`; with `holdReason` + `holdFollowUpDate` +
   `holdFollowUpBy` + `nextAction` it is 200 and the dashboard shows the
   job on hold with that data.
4. **Close gate** — `update_job` to `completed` with no verification is
   400 `VERIFICATION_REQUIRED`, and the job is still not completed after.
5. **Valid close** — closing with `verificationAction`,
   `verificationTest`, `verificationResult`, `verificationConfirmed: true`
   and `actionPerformed` is 200; the job is `completed` with `verifiedAt`
   set and `verifiedByMemberId` equal to the closer.
6. **Reopen + re-close guard** — reopening to `in_progress` is 200 and
   clears `verifiedAt`; an immediate re-close without a fresh
   `verificationConfirmed` is 400; `job_history` still contains both the
   `completed` and `reopened` entries.
7. **Optimistic locking** — two `update_job` calls carrying the same
   version: the first is 200, the second is 409 `VERSION_CONFLICT`.
8. **Visits never close a WO** — a vendor (via `POST /api/vendors`
   `create_vendor`, admin-client insert as fallback) and a visit
   (`POST /api/visits` `create`, then `complete_visit`): the visit ends in
   `completed_visit` and the linked work order's status is unchanged.
9. **Quotes** — `POST /api/quotes` creates a quote (`quotedAmount: 500`,
   `PO-TEST-1`, `GL-TEST`) for the re-closed check-5 job;
   `GET /api/quotes?workOrderId=` returns it; updating its `actualCost`
   does not change the job's `verified_*` fields.
10. **Photos** — a multipart `POST /api/photos` with a 1×1 PNG is 200;
    `GET /api/photos?workOrderId=` lists it with a `signedUrl`; the
    pending user's `GET /api/photos` is 403.
11. **Exports** — `GET /api/reports/export?module=jobs&format=json` is
    200 with envelope `timeZone: 'America/New_York'`,
    `attachmentsIncluded: false` and a `rows` array; the same export
    without `format` is 200 `text/csv`.
12. **Centro KPIs** — a dedicated hold job is placed on hold, then
    `GET /api/centro` is 200 with `kpis.blocked >= 1`.
13. **Notes rule** — `save_note_drafts` with arbitrary text (even text
    claiming completion) is 200 and returns a `notesFingerprint`
    starting `nf_`; the job's status remains exactly as created.

## How to run it against staging

Disposable staging only — never production (the suite creates accounts,
work orders, a vendor, a visit, a quote and a photo). Staging app:
`https://maintenance-staging.vercel.app`; staging Supabase ref:
`mompihbzkhjqewstpquc`, with every migration in `supabase/migrations/`
applied in order and the staging admin bootstrapped via
`docs/admin-bootstrap.sql`.

```sh
export E2E_APP_URL=https://maintenance-staging.vercel.app
export E2E_SUPABASE_URL=https://mompihbzkhjqewstpquc.supabase.co
export E2E_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
export E2E_SUPABASE_SECRET_KEY=<staging secret key>
export E2E_ADMIN_EMAIL=<staging admin email>
export E2E_ADMIN_PASSWORD=<staging admin password>
node scripts/e2e-centro.mjs
```

All values come from the environment; no key is hardcoded in the script.
With any `E2E_*` variable missing, the script prints a `SKIPPED:` line
listing the missing names and exits 0, leaving the end-to-end checks
reported as PENDING. Exit code is non-zero when any check fails.

## Phase 5 module map

| Area | API route | View | Notes |
|---|---|---|---|
| Daily summary / KPIs | `GET /api/centro` (`app/api/centro/route.ts`) | `app/centro-panel.tsx` | KPIs computed at read time (scheduled today, active, overdue, blocked, pending inspections, upcoming visits, low stock, compliance alerts); `?scope=mine` narrows the job figures |
| Central registry (jobs) | `GET`/`POST /api/dashboard` (`app/api/dashboard/route.ts`) | `app/jobs-panel.tsx`, `app/dashboard.tsx` | `create_job` / `update_job` / `save_note_drafts` / `add_collaborator` / `remove_collaborator` / `job_history`; hold, close and version gates enforced server-side via `lib/jobs-rules.ts` and `lib/notes-rules.ts` |
| Vendor visits | `GET`/`POST /api/visits` (`app/api/visits/route.ts`) | `app/visits-panel.tsx` | `create` / `update` / `confirm` / `reschedule` / `complete_visit` / `cancel`; completing a visit never touches the linked work order |
| Job quotes / costs | `GET`/`POST /api/quotes` (`app/api/quotes/route.ts`) | quotes section of `app/jobs-panel.tsx` | `create` / `update` on `job_quotes` (quoted / authorized / actual, PO, GL); quote edits never touch a job's `verified_*` fields |
| Photo gallery | `GET`/`POST /api/photos` (`app/api/photos/route.ts`) | `app/photos-panel.tsx` (gallery), `app/jobs-panel.tsx` (per-job photos) | GET unions the jobs / logbook / inspections / vendors attachment tables and mints 120 s signed URLs server-side; POST multipart uploads work-order photos to the private `jobs` bucket; `set_meta` edits description / phase (before / during / after) |
| Exports | `GET /api/reports/export` (`app/api/reports/export/route.ts`) | export links in `app/reports-panel.tsx` | Phase 5 adds `module=jobs` and `?format=json` (envelope with `generatedAt`, `timeZone`, `attachmentsIncluded: false`); default remains the Phase 4 CSV |
| Vendors (directory) | `GET`/`POST /api/vendors` (`app/api/vendors/route.ts`) | `app/vendors-panel.tsx` | Pre-Phase 5 route reused by the visits flow (`create_vendor` action supplies the vendor a visit links to) |

Migration: `supabase/migrations/20261109200000_centro_operaciones.sql`
(additive only) — widens `work_orders` with the Phase 5 columns and the
optimistic-lock `version`, and adds `work_order_collaborators`,
`work_order_history` (append-only), `work_order_attachments`,
`vendor_visits`, `job_quotes` and `inspection_readings`, the private
`jobs` storage bucket, plus `description` / `phase` on the other modules'
attachment tables. All new tables are server-only (RLS enabled, grants to
anon/authenticated revoked), per access model v2.
