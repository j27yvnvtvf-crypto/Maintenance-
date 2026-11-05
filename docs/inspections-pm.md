# Inspections, preventive maintenance & shop closing (Phase 3A)

Checklist templates managed by the administrator, inspection
executions with per-item results and photo evidence, corrective
actions generated from findings with verified closure, and the daily
Shop Closing Checklist as a real record that feeds the existing
printable format. This phase implements the "Inspecciones / PM" and
"Shop" parts of the operations-center plan; inventory/assets/vendors
(Phase 3B) and audits/exports (Phase 4) are separate.

## What was implemented

### Data model — `supabase/migrations/20261103233000_inspections_pm.sql`

New additive migration (nothing dropped, nothing altered in place;
same server-only RLS pattern as Phases 0–2):

- `inspection_templates` — admin-managed checklists: name, `template_type`
  (`inspection` | `shop_closing`), area/equipment label, description,
  `frequency_type` (`daily`/`weekly`/`monthly`/`quarterly`/`annual`/
  `custom`/`none`, default `none`) + free `frequency_note`, and
  `status` (`draft` | `published` | `archived`).
- `inspection_template_items` — items with prompt, `response_type`
  (`status` | `yes_no`), `allows_photo`, `required`, position.
- `inspections` — executions with folio `INS-YYYY-NNNN` (atomic per-year
  sequence, same pattern as the logbook), SNAPSHOTS of the template
  name/type/frequency taken at creation, title, building/unit/area/
  equipment, assignee, `scheduled_date`, status (`scheduled` |
  `in_progress` | `completed`), general notes, `signature_name`, and
  server timestamps for start/completion.
- `inspection_results` — one row per executed item, snapshotting
  prompt/response type/photo/required, with `status` in Jose's exact
  inspection criteria (`no_issue`, `pending`, `in_progress`,
  `waiting_vendor`, `completed`, `na`), an optional yes/no `answer`,
  a per-item note, and who/when answered.
- `corrective_actions` — generated from a finding result: description,
  responsible, due date, status (`open` | `in_progress` | `completed`
  | `verified`), optional links to the EXISTING `work_orders` and
  `log_events` tables (no duplicated systems), and completion /
  verification stamps (by + at).
- `inspection_history` — append-only record of every relevant change
  (created, started, result recorded, assignment, schedule, completed,
  reopened, attachments, and the whole corrective-action lifecycle).
  No API route updates or deletes these rows.
- `inspection_attachments` — evidence metadata; bytes live in a new
  PRIVATE Storage bucket `inspections`.
- `admin_audit_log` gains the four template actions
  (create/update/publish/archive_inspection_template).

Bucket choice: a DEDICATED `inspections` bucket instead of reusing
`logbook`. Each module keeps its own evidence boundary — retention,
audits and future exports can evolve per module, and a permission
mistake in one bucket cannot expose the other's evidence. This mirrors
how Phase 1 already separated `documents` from Phase 2's `logbook`.

**The system ships with NO templates.** No migration inserts any
template or item: the real checklists of The Darley are defined by
Jose (the administrator) from the applicable SOPs and manufacturer
instructions. Nothing here invents Greystar SOP content, and no
frequency is presented as official — frequency is configuration data
with a free-text source note.

### The shop closing record

The daily Shop Closing Checklist is an inspection executed from a
template of type `shop_closing` — no separate table. The API enforces
ONE record per day (creating a second one returns the existing
record's id). Completion captures the signature as the typed name
plus the server-recorded `completed_at` timestamp. The printable
`/print/shop-closing` now prints, for `?date=YYYY-MM-DD` (default
today): the real record when one exists (items as executed,
observations, completed-by, closing time, signature, real folio);
otherwise the published template's items; otherwise the original
blank form.

### API (`/api/inspections`, `/api/inspections/download`)

Every request re-reads the caller's member row from the database
(`getCurrentMember`), so suspension/revocation takes effect
immediately. Unapproved accounts get 403 before any data is read.

- `GET /api/inspections` — templates visible to the caller (published
  for the team; drafts/archived only for the admin), the inspection
  list with filters (status incl. overdue, type, assignee, search),
  computed progress/findings/open-action counts, and today's shop
  closing state for the quick action.
- `GET /api/inspections?summary=1` — Hoy card counters: overdue and
  due-today inspections, open and overdue corrective actions, top 5
  of each.
- `GET /api/inspections?id=N` — full detail: results with their
  attachments, corrective actions with link labels, general and
  per-action attachments, the append-only history, and link options
  (recent work orders and logbook events).
- `POST /api/inspections` — actions: template CRUD + status
  (admin-only, audited), create inspection (from a published template
  with snapshot, or free with ad-hoc items), assign, schedule,
  start, record result, general notes, complete (required-items gate;
  signature for shop closing), reopen, corrective-action
  create/update/complete/verify/link, and multipart
  `upload_attachment` (inspection / result / corrective action level,
  25 MB cap, same extension allowlist as the logbook).
- `GET /api/inspections/download?attachmentId=N` — the only way bytes
  leave the private bucket: approval re-checked, then a signed URL
  valid for 120 seconds.

### UI

New "Inspections" tab (bilingual ES/EN): template administration
section (admin only, with the configurable-frequency disclaimer),
shop-closing quick card for today, filterable inspection list with
progress, and a full detail view — per-item status or yes/no answers
with notes and photos, findings that spawn corrective actions with
WO/logbook linking, completion + verification, evidence attachments,
and the history timeline. The Hoy/Overview tab gains a light
attention card (overdue inspections + overdue corrective actions)
that links into the tab; the overview was not redesigned.

## Permission matrix (server + database, not just UI)

| Action | Pending / rejected / suspended / revoked | Approved (any job title) | Administrator (`is_admin`) |
| --- | --- | --- | --- |
| Any inspections endpoint | **403** | ✓ | ✓ |
| Execute inspections, record results, attach evidence | — | ✓ | ✓ |
| Create / complete / verify corrective actions | — | ✓ | ✓ |
| Create / edit / publish / archive templates | — | **403** | ✓ |
| Download evidence (120 s signed URL) | **403** | ✓ | ✓ |

`job_title` remains free, informational text: typing "Admin" grants
nothing (covered by the test suite). Verification of a corrective
action requires the action to be completed and records who verified
and when; as in the logbook, verifier ≠ completer is NOT enforced —
open decision, same as Phase 2.

## Configuration per environment

1. Apply migration `20261103233000_inspections_pm.sql` AFTER the
   Phase 0–2 migrations (it extends `admin_audit_log`'s action list
   and references `work_orders` and `log_events`). It creates the
   private `inspections` bucket by itself.
2. No new environment variables. No dependencies added
   (`pnpm audit` cannot run in this VM — registry policy; this phase
   added none).
3. Production order when Jose approves this phase: migration in
   production Supabase → merge/deploy → verify. Nothing in this phase
   has been merged or deployed.

## How to test

- **As admin**: Inspections tab → Templates → create a template
  (e.g. type "Shop closing"), add items (status or yes/no, photo,
  required), publish it. Note it appears in the shop-closing card.
- **As approved**: start today's shop closing (or any inspection from
  a published template), answer items, mark one as "Pending" and
  create a corrective action from it, link a work order, complete the
  action, verify its closure, attach a photo to an item, complete
  the inspection (it refuses while a required item is unanswered),
  then print `/print/shop-closing` and see the real record.
- **As pending**: every inspections endpoint answers 403 and the tab
  shows no data.

## Verification performed

- `verify:inspections` — **16/16** (decision tests on the real rules
  module + static contracts on migration/routes/print/dashboard).
- No regressions: `verify:access` 13/13, `verify:library` 11/11,
  `verify:logbook` 11/11.
- `typecheck`, `lint`, production `build` — all green (build output
  includes `/api/inspections` and `/api/inspections/download`).

## Limitations & pending (real)

- **End-to-end HTTP testing against staging is still pending**: the
  staging deployment is blocked by the Vercel re-authentication email
  issue (tracked separately by Jose's decision to pursue an alternate
  path — API token). Until staging is live, the six access E2E checks
  and this module's live flow remain unverified over HTTP; the rule
  suites and static contracts above are what is verified.
- **No templates are loaded.** Jose must define the real checklists
  (pool, gym, shop closing, etc.) — deliberately, per his rule of not
  assuming equipment the property may not have.
- **No notifications for corrective actions** in this phase: the
  `notifications` table only admits logbook types. The Hoy attention
  card covers visibility; extending notifications is a small future
  migration if Jose wants it.
- **No automatic recurrence**: a "weekly" template does not spawn
  inspections by itself — frequency is recorded configuration, and
  each execution is started explicitly. Automatic scheduling would
  be a separate, explicit decision.
- Frequencies are never labeled official anywhere in the UI; the
  template editor shows the disclaimer in both languages.
- Phase 3B (inventory/assets/vendors, SOP 5025 colors, reorder list
  data) and Phase 4 (audit exports) remain separate phases; the
  Inventory Reorder List print format is still a paper template.
