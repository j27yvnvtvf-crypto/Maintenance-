-- Centro de Operaciones de The Darley (Phase 5): the central work
-- registry — work orders and property tasks grow the fields the daily
-- operation actually runs on (structured building/unit, origin,
-- external WO reference, findings/cause/action, differentiated HOLD
-- states with mandatory follow-up data, structured closing
-- VERIFICATION, collaborators, an append-only change history and
-- photo attachments), vendor VISITS become records of their own
-- (a completed visit never closes a work order), job QUOTES separate
-- quoted / authorized / real cost, inventory items gain purchasing
-- references, and inspection templates gain the semiannual frequency
-- plus structured readings.
--
-- What changes:
-- * work_orders — new columns only (every one nullable or defaulted,
--   so every existing row survives untouched): record_type
--   (work_order / task), origin, external_ref, building + unit,
--   scheduled_date, findings, cause, action_performed, next_action,
--   the hold fields (hold_reason, hold_follow_up_date,
--   hold_follow_up_by), the verification fields (verification_action,
--   verification_test, verification_result, verification_confirmed,
--   verified_by_member_id / verified_by_user_id / verified_at),
--   vendor_id, the guided-note drafts (maintenance_comment_draft,
--   resident_note_draft, notes_fingerprint, notes_updated_at,
--   notes_updated_by) and the optimistic-locking `version`.
--   The status CHECK is WIDENED (additive pattern of previous
--   phases): waiting_vendor / waiting_parts / waiting_resident join
--   open / assigned / in_progress / on_hold / completed — every
--   previously valid value stays valid. 'assigned' remains readable
--   as a legacy value but is no longer a visible state: existing
--   'assigned' rows become 'open' (the assignment itself lives in
--   assigned_to and is not touched).
-- * work_order_collaborators — the extra hands on a job: one row per
--   (work order, member) pair.
-- * work_order_history — APPEND-ONLY trail per work order: creation,
--   detail edits, status changes, assignment, holds set/cleared,
--   verification, completion, reopening, cost and quote events, note
--   drafts, attachments and collaborator changes, each with the
--   old/new values in `detail`. Only the server inserts rows; the API
--   exposes no update or delete path for this table.
-- * work_order_attachments — photos and files of a job, classified
--   before / during / after with a description. Bytes live in the NEW
--   private "jobs" Storage bucket; downloads only through the
--   server's short-lived signed URLs, like every module.
-- * vendor_visits — a vendor visit as its own record: date + time,
--   building/unit, responsible member, confirmation state, the visit
--   outcome (separate from the work order's closing), scope, access
--   requirements, pending notes, quoted/PO/GL/real cost and the
--   compliance tracking fields (status, due date, NetVendor
--   reference, note). Completing a visit NEVER changes the linked
--   work order's status — the golden rule of the spec: no automatic
--   trigger completes a job. vendor_history's action CHECK is widened
--   with the visit_* actions.
-- * job_quotes — quoted vs authorized vs real cost per work order
--   and/or vendor visit (at least one parent, enforced by CHECK),
--   with PO, GL code, scope and reference. Editing a quote never
--   touches a job's verified_* fields.
-- * inventory_items — sku, unit_cost (so the total inventory value is
--   computable), gl_code, quote_ref and po_number.
-- * inspection_templates — frequency CHECK widened with 'semiannual'
--   (every previously valid frequency stays valid).
-- * inspection_readings — structured measurements taken during an
--   inspection: label, value, unit, location, when measured and who
--   recorded it, optionally pinned to one checklist result.
-- * log_attachments / inspection_attachments / vendor_attachments —
--   description + phase (before / during / after) columns, so the
--   unified photo gallery can classify evidence from every module.
--
-- Permissions (access model v2, unchanged): the server routes enforce
-- approval per request; this migration only sets the database side
-- for the NEW tables — RLS enabled, grants to anon/authenticated
-- revoked, an explicit deny policy per table — the same server-only
-- pattern as Phases 0–3.
--
-- This migration is ADDITIVE ONLY: no table or column is dropped and
-- no existing row is lost (the single data UPDATE converts the legacy
-- 'assigned' status to 'open', per the Phase 5 decision).

-- ------------------------------------------------------------------
-- Work orders: central registry fields
-- ------------------------------------------------------------------

alter table public.work_orders
  add column if not exists record_type text not null default 'work_order'
    check (record_type in ('work_order', 'task')),
  add column if not exists origin text not null default 'daily_operation'
    check (origin in (
      'daily_operation', 'resident', 'rmm_audit',
      'client_requirement', 'move_out', 'preventive'
    )),
  add column if not exists external_ref text,
  add column if not exists building text,
  add column if not exists unit text,
  add column if not exists scheduled_date date,
  add column if not exists findings text,
  add column if not exists cause text,
  add column if not exists action_performed text,
  add column if not exists next_action text;

-- Hold (espera) fields: mandatory as a set whenever the job is in a
-- hold status — enforced by the API through lib/jobs-rules.ts
-- (validateHold); the columns themselves stay nullable so non-held
-- jobs need none of them.
alter table public.work_orders
  add column if not exists hold_reason text,
  add column if not exists hold_follow_up_date date,
  add column if not exists hold_follow_up_by bigint references public.members(id) on delete set null;

-- Closing verification fields: completing a job requires the recorded
-- action, the test performed, its result and an explicit confirmation
-- (validateClose in lib/jobs-rules.ts). verified_* are written by the
-- server at the moment of verification and are cleared on reopening;
-- cost edits never touch them.
alter table public.work_orders
  add column if not exists verification_action text,
  add column if not exists verification_test text,
  add column if not exists verification_result text,
  add column if not exists verification_confirmed boolean not null default false,
  add column if not exists verified_by_member_id bigint references public.members(id) on delete set null,
  add column if not exists verified_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists vendor_id bigint references public.vendors(id) on delete set null;

-- Guided note drafts (lib/notes-rules.ts): the draft text plus the
-- fingerprint of the recorded facts it was generated from, so the UI
-- can flag a draft as stale when the facts change.
alter table public.work_orders
  add column if not exists maintenance_comment_draft text,
  add column if not exists resident_note_draft text,
  add column if not exists notes_fingerprint text,
  add column if not exists notes_updated_at timestamptz,
  add column if not exists notes_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists version integer not null default 1;

-- Widened status CHECK (additive pattern): the three differentiated
-- hold states join every previously valid value.
alter table public.work_orders
  drop constraint if exists work_orders_status_check;
alter table public.work_orders
  add constraint work_orders_status_check
  check (status in (
    'open', 'assigned', 'in_progress', 'on_hold',
    'waiting_vendor', 'waiting_parts', 'waiting_resident', 'completed'
  ));

-- 'assigned' stops being a state: the assignment lives in assigned_to.
update public.work_orders
set status = 'open'
where status = 'assigned';

-- ------------------------------------------------------------------
-- Work order collaborators
-- ------------------------------------------------------------------

create table if not exists public.work_order_collaborators (
  id bigint generated by default as identity primary key,
  work_order_id bigint not null references public.work_orders(id) on delete restrict,
  member_id bigint not null references public.members(id) on delete restrict,
  added_by_member_id bigint references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (work_order_id, member_id)
);

-- ------------------------------------------------------------------
-- Work order history (append-only)
-- ------------------------------------------------------------------

create table if not exists public.work_order_history (
  id bigint generated by default as identity primary key,
  work_order_id bigint not null references public.work_orders(id) on delete restrict,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'created', 'details_updated', 'status_changed', 'assigned',
    'hold_set', 'hold_cleared', 'verification_recorded', 'completed',
    'reopened', 'cost_updated', 'quote_added', 'quote_updated',
    'note_draft_saved', 'attachment_added',
    'collaborator_added', 'collaborator_removed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Work order attachments (private "jobs" bucket)
-- ------------------------------------------------------------------

create table if not exists public.work_order_attachments (
  id bigint generated by default as identity primary key,
  work_order_id bigint not null references public.work_orders(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  description text,
  phase text check (phase in ('before', 'during', 'after')),
  uploaded_by_member_id bigint references public.members(id) on delete set null,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Vendor visits
-- ------------------------------------------------------------------

create table if not exists public.vendor_visits (
  id bigint generated by default as identity primary key,
  vendor_id bigint not null references public.vendors(id) on delete restrict,
  vendor_job_id bigint references public.vendor_jobs(id) on delete set null,
  work_order_id bigint references public.work_orders(id) on delete set null,
  service text,
  visit_date date,
  visit_time text,
  building text,
  unit text,
  responsible_member_id bigint references public.members(id) on delete set null,
  confirmation_status text not null default 'pending' check (confirmation_status in (
    'pending', 'confirmed', 'rescheduled', 'cancelled'
  )),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'completed_visit', 'cancelled', 'no_show'
  )),
  scope text,
  access_requirements text,
  result text,
  pending_notes text,
  quoted_amount numeric(12,2),
  po_number text,
  gl_code text,
  actual_cost numeric(12,2),
  compliance_status text not null default 'to_verify' check (compliance_status in (
    'to_verify', 'verified', 'expired', 'documented_exception'
  )),
  compliance_due_date date,
  netvendor_ref text,
  compliance_note text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Visit lifecycle events join the vendor history trail (additive
-- CHECK widening, same pattern as previous phases).
alter table public.vendor_history
  drop constraint if exists vendor_history_action_check;
alter table public.vendor_history
  add constraint vendor_history_action_check
  check (action in (
    'vendor_created', 'vendor_updated', 'vendor_archived', 'vendor_reactivated',
    'job_created', 'job_updated', 'job_status_changed', 'job_completed',
    'job_verified', 'attachment_added',
    'visit_created', 'visit_updated', 'visit_rescheduled',
    'visit_completed', 'visit_cancelled'
  ));

-- ------------------------------------------------------------------
-- Job quotes (quoted / authorized / real cost)
-- ------------------------------------------------------------------

create table if not exists public.job_quotes (
  id bigint generated by default as identity primary key,
  work_order_id bigint references public.work_orders(id) on delete restrict,
  vendor_visit_id bigint references public.vendor_visits(id) on delete restrict,
  vendor_id bigint references public.vendors(id) on delete set null,
  quoted_amount numeric(12,2),
  authorized_amount numeric(12,2),
  actual_cost numeric(12,2),
  po_number text,
  gl_code text,
  reference text,
  scope text,
  notes text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_order_id is not null or vendor_visit_id is not null)
);

-- ------------------------------------------------------------------
-- Inventory: purchasing references
-- ------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists sku text,
  add column if not exists unit_cost numeric(12,2),
  add column if not exists gl_code text,
  add column if not exists quote_ref text,
  add column if not exists po_number text;

-- ------------------------------------------------------------------
-- Inspections: semiannual frequency + structured readings
-- ------------------------------------------------------------------

alter table public.inspection_templates
  drop constraint if exists inspection_templates_frequency_type_check;
alter table public.inspection_templates
  add constraint inspection_templates_frequency_type_check
  check (frequency_type in (
    'daily', 'weekly', 'monthly', 'quarterly', 'semiannual',
    'annual', 'custom', 'none'
  ));

create table if not exists public.inspection_readings (
  id bigint generated by default as identity primary key,
  inspection_id bigint not null references public.inspections(id) on delete restrict,
  result_id bigint references public.inspection_results(id) on delete set null,
  label text not null,
  value text,
  unit text,
  location text,
  measured_at timestamptz,
  recorded_by_member_id bigint references public.members(id) on delete set null,
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Attachment classification (description + phase) in every module
-- ------------------------------------------------------------------

alter table public.log_attachments
  add column if not exists description text,
  add column if not exists phase text check (phase in ('before', 'during', 'after'));

alter table public.inspection_attachments
  add column if not exists description text,
  add column if not exists phase text check (phase in ('before', 'during', 'after'));

alter table public.vendor_attachments
  add column if not exists description text,
  add column if not exists phase text check (phase in ('before', 'during', 'after'));

-- ------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------

create index if not exists work_orders_status_due_idx
  on public.work_orders (status, due_date);

create index if not exists work_orders_vendor_idx
  on public.work_orders (vendor_id) where vendor_id is not null;

create index if not exists work_order_collaborators_job_idx
  on public.work_order_collaborators (work_order_id);

create index if not exists work_order_collaborators_member_idx
  on public.work_order_collaborators (member_id);

create index if not exists work_order_history_job_idx
  on public.work_order_history (work_order_id, created_at);

create index if not exists work_order_attachments_job_idx
  on public.work_order_attachments (work_order_id, created_at);

create index if not exists vendor_visits_date_idx
  on public.vendor_visits (visit_date);

create index if not exists vendor_visits_vendor_idx
  on public.vendor_visits (vendor_id, visit_date);

create index if not exists vendor_visits_work_order_idx
  on public.vendor_visits (work_order_id) where work_order_id is not null;

create index if not exists job_quotes_work_order_idx
  on public.job_quotes (work_order_id) where work_order_id is not null;

create index if not exists job_quotes_vendor_visit_idx
  on public.job_quotes (vendor_visit_id) where vendor_visit_id is not null;

create index if not exists inspection_readings_inspection_idx
  on public.inspection_readings (inspection_id, created_at);

-- ------------------------------------------------------------------
-- Server-only access (RLS + revoke + deny policy, per new table)
-- ------------------------------------------------------------------

alter table public.work_order_collaborators enable row level security;
alter table public.work_order_history enable row level security;
alter table public.work_order_attachments enable row level security;
alter table public.vendor_visits enable row level security;
alter table public.job_quotes enable row level security;
alter table public.inspection_readings enable row level security;

-- Centro de Operaciones data is read and written exclusively by
-- authenticated server routes that enforce the access model v2 rules.
-- Browser clients get nothing directly.
revoke all on public.work_order_collaborators from anon, authenticated;
revoke all on public.work_order_history from anon, authenticated;
revoke all on public.work_order_attachments from anon, authenticated;
revoke all on public.vendor_visits from anon, authenticated;
revoke all on public.job_quotes from anon, authenticated;
revoke all on public.inspection_readings from anon, authenticated;

create policy "work_order_collaborators_server_only"
  on public.work_order_collaborators for all to anon, authenticated using (false) with check (false);
create policy "work_order_history_server_only"
  on public.work_order_history for all to anon, authenticated using (false) with check (false);
create policy "work_order_attachments_server_only"
  on public.work_order_attachments for all to anon, authenticated using (false) with check (false);
create policy "vendor_visits_server_only"
  on public.vendor_visits for all to anon, authenticated using (false) with check (false);
create policy "job_quotes_server_only"
  on public.job_quotes for all to anon, authenticated using (false) with check (false);
create policy "inspection_readings_server_only"
  on public.inspection_readings for all to anon, authenticated using (false) with check (false);

-- Private file storage for work order photos and evidence.
-- public = false means there is no anonymous URL for any file: the
-- server mints a short-lived signed URL only after checking the
-- requester's permissions.
insert into storage.buckets (id, name, public)
values ('jobs', 'jobs', false)
on conflict (id) do nothing;

-- Defense in depth: browser roles get no direct object access at all.
-- The application only ever touches objects through the server
-- (service role) and hands out signed URLs after a permission check.
create policy "jobs_bucket_server_only"
  on storage.objects
  for all
  to anon, authenticated
  using (false)
  with check (false);
