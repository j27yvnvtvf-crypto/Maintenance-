# Reports & audit dossiers (Phase 4)

Phase 4 of the operations-center plan
(`plan-expansion-centro-operaciones.md`, section 2 "Auditorías y
reportes", plus the access model of Message 2) built on top of access
model v2 (Phase 0), the document library (Phase 1), the property logbook
(Phase 2), inspections/PM (Phase 3A) and shop/inventory/vendors
(Phase 3B). This document records what exists, how permissions work,
how to configure each environment, and what is still pending.

## What was implemented

Phase 4 is a **read-only consultation layer** over the modules the
earlier phases built. It adds **no tables and no migration**: the search
and the dossiers query the existing tables and assemble the answer per
request, so a report can never drift away from the underlying records.

### Pure rules — `lib/reports-rules.ts`

Import-free and side-effect free, exercised directly by
`scripts/verify-reports.mjs`:

- Permission primitives mirroring `lib/access-rules.ts`:
  `canAccessReports`, `canBuildDossier`, `canExportReports` (all =
  operational: approved + active) and `canViewAdminActivity` (=
  administrator only). The suite asserts both modules agree on every
  account state.
- `normalizeReportFilters` — raw query parameters become a safe filter
  set: unknown modules fall back to `all`, invalid dates are dropped,
  a reversed range is swapped, free text is trimmed and length-capped,
  status must match a strict pattern.
- The **evidence honesty rule** (`evidenceState`): a record is
  `verified` ONLY when a verification act is recorded with BOTH a
  verifier and a timestamp. A record with attachments but no recorded
  verification is `evidence_unverified`; with neither, `no_evidence`.
  Attachments NEVER produce `verified`, and neither does a completed
  status. `summarizeEvidence` and `unverifiedEntries` build the
  dossier's summary and its "not verified" section from the same rule.
- `CSV_COLUMNS` — the declared column set of every exportable module —
  plus `csvEscape` (quoting + spreadsheet formula-injection guard) and
  `buildCsv`, so an export's shape is a tested contract.

### Data assembly — `lib/reports-server.ts`

Server-only, read-only (the verify suite asserts the file — and both
report routes — contain no insert/update/delete/upsert at all):

- `searchReports` — one fetcher per module (logbook, inspections,
  corrective actions, work orders, inventory, stock movements,
  reorders, tools, assets, refrigerant, vendor jobs) returning a
  unified result item (`ref`, title, local date, status, location,
  person, evidence state, attachment count, verifier + date) plus the
  declared CSV row for the same record. Per-module counts and a grand
  total are computed from the same rows the user sees.
- `buildCaseDossier(admin, eventId)` — traverses the case chain in
  BOTH directions over `log_event_links` (same walk as the logbook
  detail, capped at 100 events), then gathers everything tied to those
  events: their corrective actions and the inspections and work orders
  behind them, vendor jobs (+attachments), refrigerant records,
  inventory movements and related assets. Output is one chronological
  timeline (`sortTimeline`), an evidence summary, the explicit
  "not verified" list, and the distinct official WO references
  (external system) mentioned by the chain.
- `buildUnitDossier(admin, unit, building)` — everything recorded for
  one apartment: logbook events, inspections (and their corrective
  actions) and assets matched on the structured `unit` column; work
  orders and vendor jobs matched by containment on their free-text
  location fields (`area` / `related_location`). That containment match
  is a gathering heuristic and is documented as such — records are
  gathered, never silently merged or rewritten.
- Attachment counts come from the existing private-bucket metadata
  tables (`log_attachments`, `inspection_attachments`,
  `vendor_attachments`); no file bytes are read or served by Phase 4 —
  downloads still go through each module's signed-URL route.

### API — `app/api/reports`

- `GET /api/reports` — per-request gate (`getCurrentMember()` +
  `canAccessReports`): unapproved accounts get **403** on everything.
  Returns `{ me, members, filters, counts, total, groups }` for the
  filtered search. The `members` list is id + name of approved accounts
  — the same payload the Team tab already shows; the personal phone is
  never included.
- `GET /api/reports?case=<logEventId>` — the case dossier (404 when the
  seed event does not exist).
- `GET /api/reports?unit=<unit>[&building=<b>]` — the apartment dossier.
- `GET /api/reports?adminActivity=1` — the administrative history,
  administrator ONLY (`canViewAdminActivity`, otherwise 403). It reads
  the same `admin_audit_log` table the Phase 0 Team panel shows — the
  same log, not a copy.
- `GET /api/reports/export?module=<m>&<filters>` — the CSV file,
  generated ON THE SERVER from the same filtered query as the search,
  behind `canExportReports` (the check runs before any row is
  fetched). One module per file because each module has its own
  declared columns; `module=all` is refused with 400. The file is
  served as an attachment (`the-darley-<module>-<yyyymmdd>.csv`) with
  a UTF-8 BOM so Excel reads Spanish accents correctly.

### UI — Reports tab (`app/reports-panel.tsx`)

- Filter bar: module, date range, person, status (options follow the
  selected module), building, unit, text search, and "below minimum
  only" for inventory. Results render grouped by module with counts.
- Every record with evidence semantics carries its honesty badge:
  **Verified · name · date** (green), **Evidence available — not
  verified** (amber, with the file count), or **No evidence** (grey).
  Modules without verification semantics show no badge rather than a
  fake one.
- From a logbook result: **Case dossier**. From any result with a unit:
  **Apartment dossier**. The dossier view shows the evidence summary,
  the amber "not verified" section, and the full chronology.
- Export bar: module picker + **Download CSV** and **Print report**.
  In a dossier: **Print dossier**.
- Administrators additionally see the administrative-activity section
  (loaded on demand from `?adminActivity=1`).

### Printable sheets — `/print/audit-report`, `/print/case-dossier`

Two new formats in the Phase 1 print system (Letter, The Darley
header, folio `RPT-<date>` / `EXP-<case or unit>-<date>`, generated
timestamp AND the name of the member who generated it — the existing
`SheetHeader` plus a "Generated by" field):

- `audit-report` accepts the same filter parameters as the search and
  prints the grouped results with an Evidence / Verification column
  and the honesty note box.
- `case-dossier` accepts `?case=<id>` or `?unit=<u>[&building=<b>]`
  and prints the summary, the "not verified" table and the chronology.
- Both sit behind the same print-page gate as every other format: an
  unapproved account sees only the access-pending notice.

## Permissions (summary)

| Action | Pending / rejected / suspended / revoked | Approved | Administrator |
| --- | --- | --- | --- |
| Filtered search | 403 | ✅ | ✅ |
| Case / apartment dossier | 403 | ✅ | ✅ |
| CSV export | 403 | ✅ | ✅ |
| Printable report / dossier | notice only | ✅ | ✅ |
| Administrative activity | 403 | 403 | ✅ |

Reporting is operational: the administrator flag grants nothing extra
in the search, dossiers or exports, and `job_title` grants nothing at
all. The single admin-only surface is the administrative history,
because it is not operational data.

## Filter semantics (exact behavior)

- **Dates** compare on the property's local calendar
  (`America/New_York`, via `lib/time.localDate`) against each module's
  record date: logbook = event date (`occurred_at`); refrigerant =
  `log_date`; tools = loan date; everything else = `created_at`.
  Inventory, assets and tools are current-state records; for them the
  range applies to their registration/loan date.
- **Person** maps to each module's own person field (responsible,
  reporter, assignee, technician, current holder, or creator for
  inventory/assets).
- **Building / unit** apply to the modules with structured location
  columns (logbook, inspections, assets); when either filter is set,
  the other modules return no rows — stated in the UI hint.
- **Status** applies where the module has a status column. Stock
  movements and refrigerant rows have none, so the status filter is
  ignored for those two modules (their `type` remains searchable as
  text). The tools module, without an explicit status filter, returns
  ACTIVE LOANS only — the audit question for tools is "what is out,
  and with whom".
- **Text search** is a case-insensitive substring match over each
  module's identifying fields (folio, title/description, location,
  equipment, serial, official WO reference…).
- Each fetcher reads at most 500 recent rows per module before
  filtering (the property has 228 units and a small team); counts are
  the counts of the filtered result, and the cap is a documented
  limitation below.

## Configuration

None. Phase 4 needs no migration, no environment variable and no
storage bucket: it reads what Phases 0–3B already created.

## Tests

- `pnpm verify:reports` — **11/11**: rule/access agreement with
  `lib/access-rules.ts`; the permission matrix (non-approved = nothing,
  including export; job title "Admin" ≠ administrator; admin activity
  admin-only); filter normalization (dropped garbage, swapped range)
  and fixture filtering; the full case-chain fixture assembled
  chronologically with the correct summary and "not verified" set; the
  honesty contract (attachment-only is never `verified`; verification
  requires author AND timestamp); the CSV contract (declared columns
  per module, escaping, formula-injection guard, honest state exported
  as-is); and the static contracts (per-request gates, export gate
  before fetching, read-only assembly, print formats + dashboard tab,
  and no new migration file).
- No regressions: `verify:access` **15/15** · `verify:library`
  **11/11** · `verify:logbook` **11/11** · `verify:inspections`
  **16/16** · `verify:inventory-vendors` **22/22**.
- `typecheck` ✅ · `lint` ✅ (clean) · `build` ✅ — routes
  `/api/reports` and `/api/reports/export` present in the build output.
- Smoke (built server, dummy env): `GET /api/reports` and
  `GET /api/reports/export?module=logbook` without a session → **401
  JSON**. (With no Supabase env at all the routes answer 500 "Supabase
  public environment variables are missing", like every other route in
  the app — an environment issue, not a code path.)

## Limitations and real pending items

- **End-to-end against staging is still pending** — the same pending
  item as Phases 0–3B: HTTP behavior with real accounts (pending → 403
  on search AND on the CSV download, a real case chain round-trip, a
  CSV of real rows) requires the disposable staging deployment, which
  remains blocked by the Vercel reauthentication wall; the agreed
  alternate route is a Vercel API token from Jose via the secure
  vault card. Until that runs, E2E is NOT claimed as passed.
- **PDF = the browser's print / Save-as-PDF** of the report and
  dossier sheets (the Phase 1 pattern). There is no server-side PDF
  engine; the sheets are Letter-formatted and carry folio, generation
  timestamp and generator name.
- **Search window**: fetchers read the 500 most recent rows per module
  before in-memory filtering. For this property's volume that is far
  above real usage, but a filtered count is a count over that window,
  not an unbounded table scan.
- **Free-text location matching in dossiers**: work orders
  (`area`) and vendor jobs (`related_location`) match a unit dossier by
  text containment; a location written in an unexpected format may be
  missed. The structured modules (logbook, inspections, assets) match
  exactly on their `unit` column.
- Inspections have evidence but no verification act of their own, so
  they are never shown as verified; verification lives on their
  corrective actions (Phases 3A) — deliberate, per the honesty rule.
- External, time-limited audit access (plan section 4) is NOT
  implemented: it would be an administrative authorization flow for
  Jose to approve separately. Auditors today receive exported
  reports/dossiers (PDF/CSV), not accounts.

## State

Implemented and verified at rule/contract level on branch
`feat/reports-audit` (PR against `feat/inventory-vendors`). NOT merged,
NOT deployed. Production and its Supabase are untouched.
