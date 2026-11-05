-- Inspections & preventive maintenance (Phase 3A): admin-managed
-- checklist templates, executions with per-item results and evidence,
-- corrective actions linked to findings, an append-only history — and
-- the daily SHOP CLOSING record, which runs on the same engine: a shop
-- closing record IS an inspection executed from a template of type
-- 'shop_closing', one per day, signed with the server timestamp.
--
-- What changes:
-- * insp_folio_counters + next_inspection_folio_number() — per-year
--   counter used by the server to mint each inspection's readable folio
--   (INS-2026-0001), atomically, exactly like the logbook folios.
-- * inspection_templates — checklist templates by area or equipment.
--   name, template_type ('inspection' | 'shop_closing'), free-text area
--   label, description, a CONFIGURABLE frequency (frequency_type +
--   free-text frequency_note) and status (draft / published /
--   archived). The frequency is data the administrator sets per
--   template; the system ships NO preset frequencies and never labels
--   any of them official — frequencies come from the applicable SOPs
--   and manufacturer instructions, which are the administrator's call.
--   Only the administrator creates, edits, publishes or archives
--   templates: templates are system configuration (access model v2).
-- * inspection_template_items — the checklist items of a template:
--   prompt, position, response_type ('status' | 'yes_no'), whether a
--   photo may be attached to the item, and whether answering it is
--   required to complete an inspection. Items always keep the
--   "not applicable" escape: an item that does not apply to the
--   property or the day is answered N/A, never forced.
-- * inspections — one execution: folio, template link (nullable for
--   free inspections) with SNAPSHOTS of the template name, type and
--   frequency taken at creation time (later template edits never
--   rewrite the evidence of an inspection already executed), title,
--   building / unit / area / equipment (free text; the assets registry
--   arrives later in Phase 3), responsible member, scheduled date,
--   status (scheduled / in_progress / completed), start and completion
--   attribution, general notes, and — for shop closing records — the
--   signature name typed at completion (the completion timestamp itself
--   is recorded by the server). "Overdue" is never stored: it is
--   computed at read time from scheduled_date.
-- * inspection_results — one row per checklist item of an inspection,
--   created at execution time with SNAPSHOTS of the item prompt,
--   response type and photo permission, so the record of what was
--   asked survives any later template edit. `status` uses Jose's
--   finding states — inspection is not repair: 'no_issue',
--   'pending', 'in_progress', 'waiting_vendor' (waiting on a vendor or
--   an approval), 'completed', 'na'. `answer` holds 'yes' / 'no' for
--   yes/no items. Results are working rows: they may be corrected
--   while the inspection is not completed, and EVERY correction is
--   written to the append-only history. A completed inspection locks
--   its results; reopening unlocks them and is itself recorded.
-- * corrective_actions — the follow-up of a finding: one row per action
--   generated from a result whose status marks a finding (pending /
--   in_progress / waiting_vendor). Description, responsible member,
--   due date, status (open / in_progress / completed / verified),
--   completion attribution and closure verification (verified_by +
--   verified_at — verification is evidence someone checked the closed
--   action, recorded separately from completion). An action may link
--   to an existing work order (work_orders) or logbook event
--   (log_events) instead of duplicating those systems.
-- * inspection_history — APPEND-ONLY trail per inspection (creation,
--   start, results recorded, detail edits, assignment, schedule
--   changes, completion, reopening, attachments, and every corrective
--   action event). Only the server inserts rows; the API exposes no
--   update or delete path for this table.
-- * inspection_attachments — metadata for evidence photos and files.
--   The bytes live in the NEW private "inspections" Storage bucket.
--   A dedicated bucket (instead of reusing "logbook") keeps each
--   module's evidence under its own retention and audit boundary —
--   the same per-module pattern as "documents" (Phase 1) and
--   "logbook" (Phase 2): an auditor can be pointed at inspection
--   evidence without opening logbook evidence, and vice versa.
-- * admin_audit_log — its action list gains the four template actions
--   so every administrative change to templates lands in the Phase 0
--   audit trail, like document administration did in Phase 1.
--
-- Permissions (access model v2, enforced in server routes AND here):
-- approved accounts execute inspections with identical permissions;
-- only the administrator manages templates; unapproved accounts get
-- nothing. This migration only sets the database side: RLS enabled,
-- all grants to anon/authenticated revoked, and an explicit deny
-- policy per table as defense in depth — the same server-only pattern
-- as Phases 0, 1 and 2.
--
-- NO TEMPLATES ARE SEEDED. The real checklists of The Darley are
-- defined by the administrator from the applicable SOPs and
-- manufacturer instructions; inventing their content here would put
-- words in official documents. The system is born ready to receive
-- them.
--
-- This migration is ADDITIVE ONLY: no table or column is dropped and
-- no existing row is touched (the admin_audit_log CHECK constraint is
-- widened, exactly as Phase 1 did — every previously valid action
-- stays valid).

create table if not exists public.insp_folio_counters (
  year integer primary key,
  last_number integer not null default 0
);

-- Atomic folio increment (same pattern as next_log_folio_number).
create or replace function public.next_inspection_folio_number(p_year integer)
returns integer
language plpgsql
as $$
declare
  v_next integer;
begin
  insert into public.insp_folio_counters (year, last_number)
  values (p_year, 1)
  on conflict (year) do update
    set last_number = public.insp_folio_counters.last_number + 1
  returning last_number into v_next;
  return v_next;
end;
$$;

-- Only the server (service role, used by the API routes) may mint folios.
revoke all on function public.next_inspection_folio_number(integer)
  from public, anon, authenticated;

create table if not exists public.inspection_templates (
  id bigint generated by default as identity primary key,
  name text not null,
  template_type text not null default 'inspection' check (template_type in (
    'inspection', 'shop_closing'
  )),
  area_label text,
  description text,
  frequency_type text not null default 'none' check (frequency_type in (
    'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'custom', 'none'
  )),
  frequency_note text,
  status text not null default 'draft' check (status in (
    'draft', 'published', 'archived'
  )),
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_template_items (
  id bigint generated by default as identity primary key,
  template_id bigint not null references public.inspection_templates(id) on delete restrict,
  position integer not null check (position > 0),
  prompt text not null,
  response_type text not null default 'status' check (response_type in (
    'status', 'yes_no'
  )),
  allows_photo boolean not null default false,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (template_id, position)
);

create table if not exists public.inspections (
  id bigint generated by default as identity primary key,
  folio text not null unique,
  template_id bigint references public.inspection_templates(id) on delete set null,
  template_name text,
  template_type text not null default 'inspection' check (template_type in (
    'inspection', 'shop_closing'
  )),
  frequency_type text,
  frequency_note text,
  title text not null,
  building text,
  unit text,
  area text,
  equipment text,
  assigned_member_id bigint references public.members(id) on delete set null,
  scheduled_date date,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'in_progress', 'completed'
  )),
  general_notes text,
  signature_name text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_by_member_id bigint references public.members(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_results (
  id bigint generated by default as identity primary key,
  inspection_id bigint not null references public.inspections(id) on delete restrict,
  template_item_id bigint references public.inspection_template_items(id) on delete set null,
  position integer not null check (position > 0),
  prompt text not null,
  response_type text not null default 'status' check (response_type in (
    'status', 'yes_no'
  )),
  allows_photo boolean not null default false,
  required boolean not null default true,
  status text check (status in (
    'no_issue', 'pending', 'in_progress', 'waiting_vendor', 'completed', 'na'
  )),
  answer text check (answer in ('yes', 'no')),
  note text,
  answered_by_member_id bigint references public.members(id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inspection_id, position)
);

create table if not exists public.corrective_actions (
  id bigint generated by default as identity primary key,
  inspection_id bigint not null references public.inspections(id) on delete restrict,
  result_id bigint not null references public.inspection_results(id) on delete restrict,
  description text not null,
  responsible_member_id bigint references public.members(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in (
    'open', 'in_progress', 'completed', 'verified'
  )),
  work_order_id bigint references public.work_orders(id) on delete set null,
  log_event_id bigint references public.log_events(id) on delete set null,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  completed_by_member_id bigint references public.members(id) on delete set null,
  completed_at timestamptz,
  verified_by_member_id bigint references public.members(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_history (
  id bigint generated by default as identity primary key,
  inspection_id bigint not null references public.inspections(id) on delete restrict,
  corrective_action_id bigint references public.corrective_actions(id) on delete set null,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'created', 'started', 'result_recorded', 'details_updated', 'assigned',
    'schedule_changed', 'completed', 'reopened', 'attachment_added',
    'corrective_created', 'corrective_updated', 'corrective_completed',
    'corrective_verified', 'corrective_linked'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inspection_attachments (
  id bigint generated by default as identity primary key,
  inspection_id bigint not null references public.inspections(id) on delete restrict,
  result_id bigint references public.inspection_results(id) on delete set null,
  corrective_action_id bigint references public.corrective_actions(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  uploaded_by_member_id bigint references public.members(id) on delete set null,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inspection_templates_status_idx
  on public.inspection_templates (status);

create index if not exists inspection_template_items_template_idx
  on public.inspection_template_items (template_id, position);

create index if not exists inspections_status_idx
  on public.inspections (status);

create index if not exists inspections_assigned_idx
  on public.inspections (assigned_member_id);

create index if not exists inspections_scheduled_idx
  on public.inspections (scheduled_date)
  where status <> 'completed';

create index if not exists inspections_type_date_idx
  on public.inspections (template_type, scheduled_date desc);

create index if not exists inspection_results_inspection_idx
  on public.inspection_results (inspection_id, position);

create index if not exists corrective_actions_inspection_idx
  on public.corrective_actions (inspection_id, created_at);

create index if not exists corrective_actions_status_idx
  on public.corrective_actions (status, due_date);

create index if not exists corrective_actions_result_idx
  on public.corrective_actions (result_id);

create index if not exists inspection_history_inspection_idx
  on public.inspection_history (inspection_id, created_at);

create index if not exists inspection_attachments_inspection_idx
  on public.inspection_attachments (inspection_id, created_at);

create index if not exists inspection_attachments_result_idx
  on public.inspection_attachments (result_id)
  where result_id is not null;

alter table public.insp_folio_counters enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspection_template_items enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_results enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.inspection_history enable row level security;
alter table public.inspection_attachments enable row level security;

-- Inspection data is read and written exclusively by authenticated
-- server routes that enforce the access model v2 rules. Browser
-- clients get nothing directly.
revoke all on public.insp_folio_counters from anon, authenticated;
revoke all on public.inspection_templates from anon, authenticated;
revoke all on public.inspection_template_items from anon, authenticated;
revoke all on public.inspections from anon, authenticated;
revoke all on public.inspection_results from anon, authenticated;
revoke all on public.corrective_actions from anon, authenticated;
revoke all on public.inspection_history from anon, authenticated;
revoke all on public.inspection_attachments from anon, authenticated;

create policy "insp_folio_counters_server_only"
  on public.insp_folio_counters
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspection_templates_server_only"
  on public.inspection_templates
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspection_template_items_server_only"
  on public.inspection_template_items
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspections_server_only"
  on public.inspections
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspection_results_server_only"
  on public.inspection_results
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "corrective_actions_server_only"
  on public.corrective_actions
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspection_history_server_only"
  on public.inspection_history
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "inspection_attachments_server_only"
  on public.inspection_attachments
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Administrative actions on templates join the Phase 0 audit trail.
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in (
    'approve_member', 'reject_member', 'suspend_member', 'revoke_member',
    'add_member', 'bootstrap_admin',
    'create_document', 'update_document', 'publish_document',
    'archive_document', 'add_document_version',
    'create_inspection_template', 'update_inspection_template',
    'publish_inspection_template', 'archive_inspection_template'
  ));

-- Private file storage for inspection evidence (photos per item,
-- general photos, corrective-action evidence). public = false means
-- there is no anonymous URL for any file: the server mints a
-- short-lived signed URL only after checking the requester's
-- permissions.
insert into storage.buckets (id, name, public)
values ('inspections', 'inspections', false)
on conflict (id) do nothing;

-- Defense in depth: browser roles get no direct object access at all.
-- The application only ever touches objects through the server
-- (service role) and hands out signed URLs after a permission check.
create policy "inspections_bucket_server_only"
  on storage.objects
  for all
  to anon, authenticated
  using (false)
  with check (false);
