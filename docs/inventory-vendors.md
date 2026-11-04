# Phase 3B — Shop, inventory & assets · Vendors & pendings · Training records

Branch: `feat/inventory-vendors` (from `feat/inspections-pm`, PR against it).
Status: **implemented and verified locally — NOT merged, NOT deployed.**
No production data, project or configuration was touched.

## What was implemented

### 1) Shop — inventory (SOP 5025)

- `inventory_items`: name, **SOP 5025 color category** (the ten categories
  exactly as Jose dictated them — fixed system constants in
  `lib/inventory-vendors-rules.ts`, not editable configuration, so nobody
  can re-label the official code), quantity on hand, minimum, unit,
  supplier, structured physical location (zone / shelf / bin), notes,
  active/archived.
- `inventory_movements`: append-only ledger (in / out / signed
  adjustment) with quantity, reason, optional WO / logbook links, author
  and timestamp. **Stock changes only through movements**: the item
  update action rejects any quantity field with a 400. Replaying the
  ledger reproduces the stock exactly (proven in the verify suite).
- `reorder_requests`: created automatically when a movement leaves an
  active item at/below its minimum **and no open request exists** (never
  duplicated), or manually. Lifecycle pending → ordered → received (or
  cancelled), with ordered/received attribution; receiving can enter the
  units through the same ledger in the same action. Suggested quantity
  (restock to 2× minimum) is an editable default, never an imposed order.
- `tools` + `tool_loans` (append-only): catalog with current holder,
  loaned-at, loan/return history; a loaned tool cannot change status
  until returned.

### 2) Assets / equipment

- `assets`: name, free-text type, building / unit / area, brand, model,
  serial, installed / purchase dates, warranty end date (state computed
  at read time), status, and `manual_document_id` → a Library document
  (the file itself is never duplicated).
- History (`asset_history`, append-only) fed by `asset_links` to logbook
  events and work orders, refrigerant records, and events **born linked**:
  Phase 2's `create_event` now accepts an optional `assetId` and stores
  it in the new nullable `log_events.asset_id`. The free-text equipment
  field and everything else from Phase 2 are untouched.

### 3) Refrigerant records — GENERIC structure, official form pending

- `refrigerant_logs`: date, asset (or free-text equipment), refrigerant
  type, amount added / recovered + unit, technician, reason, optional
  WO / logbook references. An entry must move some gas (rule-tested).
- **The official refrigerant form has not been provided.** This is a
  generic usage record; the UI shows a visible disclaimer and nothing in
  the system claims compliance with any official format. The exact
  fields will be adjusted when Jose shares the official form.

### 4) Vendors & pendings

- `vendors`: directory (company, contact, phone, email, specialty,
  notes; archive instead of delete).
- `vendor_jobs`: requests, appointments, quotes, reports and **pending
  parts / services**, with scheduled date, apartment/area or asset,
  responsible member, next action + date (overdue computed at read),
  links to a work order and to a logbook event (a `vendor_visit` can be
  the same event — recorded once, linked, never duplicated).
- Completion records who/when (+ optional evidence notes in history);
  **final verification is a separate recorded step** (verifier + date,
  only once, only on completed work). Open decision, documented in the
  rules: the spec does not require the verifier to differ from whoever
  completed the job, so no separation of duties is imposed.
- `vendor_attachments` in the new **private `vendors` bucket** (quotes,
  reports, evidence). Downloads only via `/api/vendors/download`:
  fresh approval check per request + 120-second signed URL.
- `vendor_history` is append-only and records every change.

### 5) Training & safety meetings (records)

- `training_sessions` with attendees (members), key points, presenter,
  and `training_documents` pinning the **exact document version**
  reviewed. Read confirmations are NOT duplicated: they live in the
  Library (Phase 1, per version); the session links to that evidence.
- `training_actions`: follow-up items with owner, due date and recorded
  completion.

### 6) Print formats now fed by real data

- **Pending Parts & Vendor Log** ← open pending parts/services from
  vendor jobs (owner + next action included).
- **Inventory Reorder List** ← open reorder requests, with the SOP 5025
  color legend and labels.
- **Training & Safety Meeting Log** ← one recorded session
  (`?session=<id>`, default most recent): pinned document versions,
  attendees with their job titles, key points, action items.
- All three keep the blank paper template at `?blank=1`.

### Access (Phase 0 model, unchanged)

Every route re-reads the member on each request; only approved + active
accounts get data (403 otherwise — including the Hoy summary and file
downloads). Approved accounts operate in **equality**: there is no
admin-only operational gate in this phase, and structural constants
(SOP 5025 categories) are fixed by design rather than configurable.

## Migration

`supabase/migrations/20261103240000_inventory_vendors.sql` — additive
only: 19 new tables (all server-only: RLS enabled, no client policies),
the private `vendors` storage bucket, and one nullable column
(`log_events.asset_id`). **No seed data**: inventory, tools, assets,
vendors and training all start empty — the team loads its real data.
Nothing destructive; safe to apply on staging and, once approved, on
production after the earlier migrations.

## How to test (on staging, once deployed)

- **As Jose (admin)**: everything below, plus the Phase 0 admin panel
  (unchanged). No Phase 3B screen requires admin.
- **As an approved member**: create an item with minimum 5 and stock 8;
  record an "out" of 4 → stock 4, an automatic reorder request appears
  (suggested 6); mark it ordered, receive 6 → stock 10 through the
  ledger. Loan a tool to a teammate and return it. Register an asset,
  link the manual from the Library, create a logbook event from the
  asset page and see it in the asset history. Add a vendor, open a
  "pending part" job with a next action, attach a quote, complete it,
  verify it. Record a training session pinning a document version and
  print the three formats (data and `?blank=1`).
- **As a pending account**: every Phase 3B endpoint returns 403 and the
  panels stay empty; the print formats show the access-pending notice.

## Verification (local, this branch)

- `pnpm verify:inventory-vendors` — decision tests over the real rules
  (permission matrix + agreement with Phase 0, SOP 5025 constants,
  ledger reconciliation, reorder dedupe, loan/return, refrigerant
  validity, vendor verification, overdue-at-read) + static contracts
  (server-only tables, private bucket, ledger-only stock, no seeds,
  print contracts, dashboard wiring).
- Previous suites re-run without regressions: `verify:access`,
  `verify:library`, `verify:logbook`, `verify:inspections`.
- typecheck / lint / build green.

## Limitations & real pendings

- **Official refrigerant form pending** (Jose's document): fields will
  be adjusted when provided. The UI says so explicitly.
- **Initial data is loaded by the team**: no inventory, asset, vendor or
  training seed data exists or was invented.
- E2E with real accounts (admin / approved / pending) runs on the
  staging project once it is deployed — same pending item as Phases
  0–3A; nothing here is merged or deployed.
- Vendor job working-state transitions (open ↔ scheduled ↔ in_progress,
  cancel) live in the API route; completion and verification are gated
  by the pure rules the suite tests.
