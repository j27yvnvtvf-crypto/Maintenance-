# Property logbook (Phase 2)

Phase 2 of the operations-center plan
(`plan-expansion-centro-operaciones.md`, section 2 "Bitácora de la
propiedad", plus the history/privacy rules of section 5) built on top of
access model v2 (Phase 0) and the document library (Phase 1). This
document records what exists, how permissions work, how to configure
each environment, and what is still pending.

## What was implemented

### Data model

Migration `20261103230000_logbook.sql` (additive only):

- `log_events` — one row per event:
  - `folio` — human-readable identifier (`BIT-2026-0001`), minted
    atomically in the database by `log_folio_counters` +
    `next_log_folio_number()` so simultaneous creations never collide.
  - `event_type` — `leak`, `equipment_failure`, `emergency_call`,
    `damage`, `vendor_visit`, `inspection`, `repair`, `other`.
  - `occurred_at` (when it happened) kept **separate** from
    `created_at` (when it was registered).
  - Reporter (`reported_by_member_id`), `building`, `unit`, `area`,
    `equipment` (free text — the equipment registry arrives with the
    assets module in Phase 3).
  - `description`, `findings`, `actions_taken`.
  - `responsible_member_id`, `priority`
    (`low` / `medium` / `high` / `emergency`), `follow_up_date`.
  - `status` — `open`, `in_progress`, `pending`, `closed`.
  - `final_result`, closure attribution (`closed_by_member_id`,
    `closed_at`) and verification (`verified_by_member_id`,
    `verified_at`) — verification is evidence that someone checked the
    closed case; it is recorded separately from the closure itself.
  - `official_wo_ref` — free-text reference to the work order in
    Greystar's official system, when one exists. This app complements
    that system; it does not replace its records.
- `log_event_links` — relationships between events of the same case
  (relation: `related`, `inspection`, `vendor_visit`, `report`,
  `repair`, `verification`, `follow_up`). The case view traverses links
  in **both directions**, so a case reads as one timeline:
  leak → inspection → roofer visit → report → interior repair →
  verification.
- `log_comments` — comments per event with author and timestamp.
  Comments are **never edited or deleted** through the app; a
  correction is a new comment.
- `log_history` — **append-only** trail per event: `created`,
  `details_updated`, `status_changed`, `assigned`, `priority_changed`,
  `follow_up_changed`, `closed`, `reopened`, `verified`,
  `comment_added`, `attachment_added`, `linked` — each with actor and
  timestamp. Only server code inserts rows; the API exposes no update
  or delete path for this table (or for comments, events, links or
  attachment records).
- `log_attachments` — metadata for evidence files. The bytes live in
  the private `logbook` Storage bucket (created by the migration with
  `public = false`); uploads/downloads happen only in server routes
  after a permission check; downloads redirect to a signed URL valid
  for 120 seconds. No attachment content is ever committed to this
  repository.
- `notifications` — stored in-app notifications for two events:
  you are assigned a logbook event, and someone comments on an event
  you reported or are responsible for. **Overdue follow-ups are not
  stored**: they are computed at read time from `follow_up_date`
  (property local date), so they can never go stale. No email or push
  in this phase.

### API (`/api/logbook`, `/api/logbook/download`)

Every request re-reads the account state from the database (Phase 0
gate) before anything else. Actions: `create_event`, `update_event`,
`set_status`, `assign`, `set_priority`, `set_follow_up`, `close_event`,
`reopen_event`, `verify_event`, `add_comment`, `link_event`,
`upload_attachment` (multipart), `mark_notifications_read`. Reads:
list with filters (status, priority, type, responsible member, text
search over folio / building / unit / area / equipment / description /
official WO ref), event detail (event + case chain + comments +
attachments + full history), and `?summary=1` for the Hoy card.

### UI

- New **Logbook / Bitácora** tab (dashboard side nav and mobile nav):
  notifications and my overdue follow-ups on top, search + filters,
  event list with overdue / verified indicators, and a full detail
  view — data, case timeline, quick actions (status, priority,
  assignment, follow-up, edit details, close with final result,
  reopen, verify), case linking, photo/file attachments from the
  phone, comments, and the complete history.
- The create form is brief first (type, event date/time, description,
  location) with the rest (findings, actions, priority, responsible,
  follow-up, official WO reference, link to an existing case) in a
  collapsible "more details" section.
- **Hoy / Overview card**: open logbook events by priority and the
  overdue follow-ups that need attention, linking into the tab.

## Permission matrix (server + database, not just UI)

The logbook is an operational module under access model v2: there are
no permission tiers inside it.

| Action | Pending / rejected / suspended / revoked | Approved (any job title) | Administrator |
| --- | --- | --- | --- |
| List / view events, chains, comments, history | **403 — nothing** | Yes | Yes (same) |
| Create / update / assign / set priority & follow-up | 403 | Yes | Yes (same) |
| Comment | 403 | Yes | Yes (same) |
| Upload / download attachments | 403 | Yes (signed URL, 120 s) | Yes (same) |
| Link events into a case | 403 | Yes | Yes (same) |
| Close (final result required) / reopen / verify | 403 | Yes | Yes (same) |
| Delete or edit events, comments, attachments, history | 403 | **No — no such path exists** | **No — no such path exists** |

The pure decision rules live in `lib/logbook-rules.ts` and mirror
`lib/access-rules.ts`; `job_title`, the legacy `role` and `is_admin`
are never inputs to a logbook permission (the administrator flag
grants nothing extra here — administration remains for accounts,
configuration and the library, per Phase 0/1).

## Configuration per environment

1. Apply the migrations in order, including
   `20261103213000_access_model_v2.sql` (Phase 0),
   `20261103220000_library_documents.sql` (Phase 1) and
   `20261103230000_logbook.sql` (Phase 2). The Phase 2 migration itself
   creates the storage bucket and the folio function — no manual
   setup is needed.
2. Verify in Supabase: Storage shows a **private** bucket named
   `logbook`; the tables `log_events`, `log_event_links`,
   `log_comments`, `log_history`, `log_attachments`, `notifications`
   and `log_folio_counters` exist with RLS enabled and no
   anon/authenticated grants.
3. No new environment variables are required.

## How to test

- **As an approved account**: Logbook tab → New event (a leak in a
  unit, with a follow-up date yesterday) → it appears in the list
  flagged overdue and in your attention list → open it: add a comment,
  attach a photo from the phone, change status, assign it to a
  teammate (they get a notification) → create a second event
  (inspection) and link it to the first → the case timeline shows both
  → close the first with a final result → verify it → the full history
  shows every step with author and time. Nothing can be deleted.
- **As the administrator**: exactly the same operational flow (the
  logbook grants the administrator nothing extra); administration
  remains in the Team and Library tabs.
- **As a pending account**: `/api/logbook` returns 403 and the
  dashboard never shows the tab's data — no list, no files.

## Verification performed

- `pnpm verify:logbook` — 11/11: decision tests for the matrix above
  (including agreement with `lib/access-rules.ts` on every account
  state, close-requires-result, read-time overdue computation and
  notification recipients) plus static contract tests over the shipped
  source (additive migration, private bucket, server-only RLS, atomic
  folio function restricted to the server, append-only history with no
  mutation path, signed-URL-only downloads, dashboard exposure).
- `pnpm verify:access` — 13/13 and `pnpm verify:library` — 11/11
  (previous suites still green).
- `pnpm build`, `pnpm typecheck`, `pnpm lint` — pass.
  (In this sandbox pnpm itself is unavailable; the equivalent
  `node_modules/.bin` binaries were invoked directly.)
- Smoke test of the production build: `GET /api/logbook` and
  `GET /api/logbook/download` without a session answer **401 JSON**;
  `/` redirects to login (307).

## Limitations & pending (real)

- **End-to-end tests against a live Supabase are PENDING**: a real
  photo round-trip (upload → signed-URL download), pending-account
  403s over HTTP, case-chain persistence, notifications and folio
  sequencing under concurrency need the disposable staging Supabase
  project (migrations are applied there; a staging deployment of this
  branch is still missing) — the same staging the Phase 0 E2E harness
  (`scripts/e2e-access-model.mjs`) is waiting for. Decision-level and
  contract-level verification is done; HTTP-level verification with
  real accounts is not claimed.
- **Open decision — verification**: the specification does not say
  whether the person who verifies a closed event must differ from the
  person who closed it. This phase does **not** impose a separation of
  duties: any approved account may verify any closed, unverified
  event. The rule lives in one place (`canVerifyEvent` in
  `lib/logbook-rules.ts`) if Jose decides otherwise.
- **Links cannot be removed through the app.** Following the
  append-only rule for the module, a mistaken link stays in the case
  trail rather than being silently erased. If this proves impractical
  in daily use, an audited "unlink" action can be added later as a new
  history-recorded operation.
- `equipment` is free text in this phase; it becomes a reference to
  the equipment/asset registry in Phase 3.
- Notifications are in-app only (no email/push) and are generated for
  assignments and comments on your events; status changes and closures
  do not notify, to avoid unnecessary notices — they are visible in
  the event history and the Hoy card.
- The Hoy card reads open events team-wide for its counts; the
  logbook tab's attention list is personal (events you reported or
  are responsible for).
