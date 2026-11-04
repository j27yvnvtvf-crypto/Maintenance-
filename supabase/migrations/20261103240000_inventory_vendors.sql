-- Shop, inventory, assets, vendors & training (Phase 3B): the physical
-- organization of the shop and the office, in digital form — stock with
-- an append-only movement ledger, reorder requests, tools with loans,
-- the equipment (assets) registry, a generic refrigerant log, the
-- vendor directory with its pending work, and the training records.
-- This migration also connects the three printable formats that Phase 1
-- shipped as paper templates (Pending Parts & Vendor Log, Inventory
-- Reorder List, Training & Safety Meeting Log) to real data.
--
-- What changes:
-- * inventory_items — one row per stock item: name, the SOP 5025 color
--   category EXACTLY as Jose shared it (the ten keys in the CHECK
--   below — fixed system constants taken from his list, never edited
--   by the app and never re-labelled as anything else), quantity on
--   hand, minimum, unit, preferred supplier and the PHYSICAL location
--   as structured text (zone / shelf / bin). The quantity on hand is
--   a working column: it changes ONLY in the same server request that
--   records a movement (see below) — there is no API path that edits
--   stock silently. Items are archived, never deleted.
-- * inventory_movements — the APPEND-ONLY stock ledger: in / out /
--   adjustment, quantity, reason, optional work-order or logbook-event
--   link, author and timestamp. Only the server inserts rows; the API
--   exposes no update or delete path for this table.
-- * inventory_history — APPEND-ONLY trail per item (creation, detail
--   edits, archive / reactivate, reorder events). Stock changes live
--   in the ledger above; this table keeps the rest of the item's life.
-- * reorder_requests — a restock request per item: quantity requested,
--   status (pending / ordered / received / cancelled), origin (auto:
--   raised by the server when a movement leaves the item at or below
--   its minimum and no open request exists — never duplicated; or
--   manual), responsible member, and the ordered / received
--   attribution. Marking a request received can record the inbound
--   movement in the same request, so stock and paperwork never drift.
-- * tools + tool_loans — the tool catalogue (status available /
--   loaned / maintenance / retired) and its append-only loan history:
--   who holds each tool, since when, and the recorded return. The
--   current holder lives on the tool row; every change is a loan row.
-- * assets — the equipment registry: name, free-text type, location
--   (building / unit / area), brand, model, serial number, install
--   and purchase dates when known, warranty end date, and the manual
--   as a LINK to an existing Library document (manual_document_id →
--   documents.id): the file itself is never duplicated — the Library
--   keeps the only copy, with its versions.
-- * asset_links + log_events.asset_id — the asset's history: a logbook
--   event can be born linked to an asset (new optional column on
--   log_events, set when the event is created from the asset), and
--   existing logbook events and work orders can be linked to an asset
--   from its detail (asset_links). Links are never removed through
--   the app.
-- * asset_history — APPEND-ONLY trail per asset (creation, edits,
--   status, manual links, event / work-order links, refrigerant use).
-- * refrigerant_logs — APPEND-ONLY use records: date, asset (or
--   free-text equipment), refrigerant type, amounts added and
--   recovered, technician, reason, optional WO / logbook link.
--   IMPORTANT: the specification asks for records "based on the
--   official form" — that form is NOT in our hands, so this is a
--   GENERIC record structure. Nothing here claims to reproduce or
--   satisfy an official form; the exact fields are adjusted when
--   Jose provides the official document.
-- * vendors — the directory: company, contact, phone, email,
--   specialty, notes. Archived, never deleted.
-- * vendor_jobs — the work with vendors: requests, appointments,
--   quotes, reports and the PENDING parts and services: kind, title,
--   status (open / scheduled / in_progress / completed / verified /
--   cancelled), scheduled date, related apartment or equipment (text
--   and/or an asset), responsible member, NEXT ACTION + its date
--   (overdue computed at read time, never stored), optional WO /
--   logbook links, and completion recorded separately from the final
--   VERIFICATION (verified_by + verified_at — evidence someone
--   checked the finished work).
-- * vendor_attachments — quotes, reports and evidence photos. Bytes
--   live in the NEW private "vendors" Storage bucket; downloads only
--   through the server's short-lived signed URLs, like every module.
-- * vendor_history — APPEND-ONLY trail per vendor and per job.
-- * training_sessions / training_attendees / training_documents /
--   training_actions / training_history — the meeting & training
--   records: date, times, topic, presenter, location, key points;
--   participants (members); the Library documents reviewed, pinned
--   to the exact VERSION that was reviewed (document_version_id) —
--   read confirmations themselves stay in the Library's
--   document_reads (Phase 1) and are never duplicated here; and the
--   follow-up action items with a responsible member and due date.
--
-- Permissions (access model v2, enforced in server routes AND here):
-- approved accounts operate shop, vendors and training with
-- identical permissions; unapproved accounts get nothing. Structural
-- configuration is limited to what the administrator already owns in
-- earlier phases (templates, documents): the SOP 5025 color list is
-- a fixed constant from Jose's specification, not app configuration.
-- This migration only sets the database side: RLS enabled, grants to
-- anon/authenticated revoked, an explicit deny policy per table —
-- the same server-only pattern as Phases 0, 1, 2 and 3A.
--
-- This migration is ADDITIVE ONLY: no table or column is dropped and
-- no existing row is touched (log_events only GAINS a nullable
-- column).

-- ------------------------------------------------------------------
-- Inventory
-- ------------------------------------------------------------------

create table if not exists public.inventory_items (
  id bigint generated by default as identity primary key,
  name text not null,
  color_category text not null check (color_category in (
    'paint_chemicals',  -- Amarillo: pinturas y químicos
    'cleaning',         -- Verde oscuro: limpieza
    'construction',     -- Marrón: materiales de construcción
    'hardware',         -- Naranja: hardware / herrajes
    'lighting',         -- Granate: iluminación
    'appliances',       -- Blanco: electrodomésticos
    'electrical',       -- Verde: electricidad
    'plumbing',         -- Azul: plomería
    'hvac',             -- Rojo: HVAC
    'safety'            -- Amarillo (muro de seguridad): seguridad
  )),
  quantity_on_hand numeric(12,2) not null default 0,
  min_quantity numeric(12,2) not null default 0,
  unit text,
  supplier text,
  location_zone text,
  location_shelf text,
  location_bin text,
  notes text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id bigint generated by default as identity primary key,
  item_id bigint not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity numeric(12,2) not null,
  reason text,
  work_order_id bigint references public.work_orders(id) on delete set null,
  log_event_id bigint references public.log_events(id) on delete set null,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_history (
  id bigint generated by default as identity primary key,
  item_id bigint not null references public.inventory_items(id) on delete restrict,
  reorder_request_id bigint,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'created', 'details_updated', 'archived', 'reactivated',
    'reorder_created', 'reorder_status_changed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reorder_requests (
  id bigint generated by default as identity primary key,
  item_id bigint not null references public.inventory_items(id) on delete restrict,
  quantity_requested numeric(12,2) not null,
  status text not null default 'pending' check (status in (
    'pending', 'ordered', 'received', 'cancelled'
  )),
  source text not null default 'manual' check (source in ('auto', 'manual')),
  responsible_member_id bigint references public.members(id) on delete set null,
  notes text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  ordered_by_member_id bigint references public.members(id) on delete set null,
  ordered_at timestamptz,
  received_by_member_id bigint references public.members(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_history
  drop constraint if exists inventory_history_reorder_fk;
alter table public.inventory_history
  add constraint inventory_history_reorder_fk
  foreign key (reorder_request_id) references public.reorder_requests(id) on delete set null;

-- ------------------------------------------------------------------
-- Tools
-- ------------------------------------------------------------------

create table if not exists public.tools (
  id bigint generated by default as identity primary key,
  name text not null,
  description text,
  serial_number text,
  status text not null default 'available' check (status in (
    'available', 'loaned', 'maintenance', 'retired'
  )),
  current_holder_member_id bigint references public.members(id) on delete set null,
  loaned_at timestamptz,
  notes text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tool_loans (
  id bigint generated by default as identity primary key,
  tool_id bigint not null references public.tools(id) on delete restrict,
  action text not null check (action in ('loan', 'return')),
  holder_member_id bigint references public.members(id) on delete set null,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  note text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Assets / equipment
-- ------------------------------------------------------------------

create table if not exists public.assets (
  id bigint generated by default as identity primary key,
  name text not null,
  asset_type text,
  building text,
  unit text,
  area text,
  brand text,
  model text,
  serial_number text,
  installed_date date,
  purchase_date date,
  warranty_end_date date,
  manual_document_id bigint references public.documents(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  notes text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A logbook event can be born linked to an asset (created from the
-- asset's detail). Optional and nullable: every existing event keeps
-- working with its free-text equipment field untouched.
alter table public.log_events
  add column if not exists asset_id bigint references public.assets(id) on delete set null;

create table if not exists public.asset_links (
  id bigint generated by default as identity primary key,
  asset_id bigint not null references public.assets(id) on delete restrict,
  log_event_id bigint references public.log_events(id) on delete restrict,
  work_order_id bigint references public.work_orders(id) on delete restrict,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (log_event_id is not null or work_order_id is not null)
);

create table if not exists public.asset_history (
  id bigint generated by default as identity primary key,
  asset_id bigint not null references public.assets(id) on delete restrict,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'created', 'details_updated', 'status_changed', 'manual_linked',
    'event_linked', 'work_order_linked', 'refrigerant_logged'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Refrigerant records (generic structure — see header note)
-- ------------------------------------------------------------------

create table if not exists public.refrigerant_logs (
  id bigint generated by default as identity primary key,
  log_date date not null,
  asset_id bigint references public.assets(id) on delete set null,
  equipment_text text,
  refrigerant_type text not null,
  amount_added numeric(10,2) not null default 0,
  amount_recovered numeric(10,2) not null default 0,
  amount_unit text not null default 'lb',
  technician_member_id bigint references public.members(id) on delete set null,
  reason text,
  work_order_id bigint references public.work_orders(id) on delete set null,
  log_event_id bigint references public.log_events(id) on delete set null,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Vendors
-- ------------------------------------------------------------------

create table if not exists public.vendors (
  id bigint generated by default as identity primary key,
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  specialty text,
  notes text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_jobs (
  id bigint generated by default as identity primary key,
  vendor_id bigint not null references public.vendors(id) on delete restrict,
  kind text not null check (kind in (
    'request', 'appointment', 'quote', 'report', 'pending_part', 'pending_service'
  )),
  title text not null,
  description text,
  status text not null default 'open' check (status in (
    'open', 'scheduled', 'in_progress', 'completed', 'verified', 'cancelled'
  )),
  scheduled_date date,
  related_location text,
  asset_id bigint references public.assets(id) on delete set null,
  equipment_text text,
  responsible_member_id bigint references public.members(id) on delete set null,
  next_action text,
  next_action_date date,
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

create table if not exists public.vendor_attachments (
  id bigint generated by default as identity primary key,
  vendor_job_id bigint not null references public.vendor_jobs(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  uploaded_by_member_id bigint references public.members(id) on delete set null,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_history (
  id bigint generated by default as identity primary key,
  vendor_id bigint not null references public.vendors(id) on delete restrict,
  vendor_job_id bigint references public.vendor_jobs(id) on delete restrict,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'vendor_created', 'vendor_updated', 'vendor_archived', 'vendor_reactivated',
    'job_created', 'job_updated', 'job_status_changed', 'job_completed',
    'job_verified', 'attachment_added'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Training & safety meetings
-- ------------------------------------------------------------------

create table if not exists public.training_sessions (
  id bigint generated by default as identity primary key,
  session_date date not null,
  start_time text,
  end_time text,
  topic text not null,
  presenter_name text,
  presenter_member_id bigint references public.members(id) on delete set null,
  location text,
  key_points text,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_attendees (
  id bigint generated by default as identity primary key,
  session_id bigint not null references public.training_sessions(id) on delete restrict,
  member_id bigint not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, member_id)
);

create table if not exists public.training_documents (
  id bigint generated by default as identity primary key,
  session_id bigint not null references public.training_sessions(id) on delete restrict,
  document_id bigint not null references public.documents(id) on delete restrict,
  document_version_id bigint not null references public.document_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, document_version_id)
);

create table if not exists public.training_actions (
  id bigint generated by default as identity primary key,
  session_id bigint not null references public.training_sessions(id) on delete restrict,
  description text not null,
  responsible_member_id bigint references public.members(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'completed')),
  completed_by_member_id bigint references public.members(id) on delete set null,
  completed_at timestamptz,
  created_by_member_id bigint references public.members(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_history (
  id bigint generated by default as identity primary key,
  session_id bigint not null references public.training_sessions(id) on delete restrict,
  actor_member_id bigint references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null check (action in (
    'created', 'details_updated', 'attendees_updated', 'documents_updated',
    'action_created', 'action_completed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------

create index if not exists inventory_items_category_idx
  on public.inventory_items (color_category, status);

create index if not exists inventory_items_status_idx
  on public.inventory_items (status);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_history_item_idx
  on public.inventory_history (item_id, created_at);

create index if not exists reorder_requests_item_idx
  on public.reorder_requests (item_id, status);

create index if not exists reorder_requests_status_idx
  on public.reorder_requests (status, created_at desc);

create index if not exists tools_status_idx
  on public.tools (status);

create index if not exists tool_loans_tool_idx
  on public.tool_loans (tool_id, created_at desc);

create index if not exists assets_status_idx
  on public.assets (status);

create index if not exists log_events_asset_idx
  on public.log_events (asset_id) where asset_id is not null;

create index if not exists asset_links_asset_idx
  on public.asset_links (asset_id, created_at);

create index if not exists asset_history_asset_idx
  on public.asset_history (asset_id, created_at);

create index if not exists refrigerant_logs_date_idx
  on public.refrigerant_logs (log_date desc);

create index if not exists refrigerant_logs_asset_idx
  on public.refrigerant_logs (asset_id) where asset_id is not null;

create index if not exists vendors_status_idx
  on public.vendors (status);

create index if not exists vendor_jobs_vendor_idx
  on public.vendor_jobs (vendor_id, created_at desc);

create index if not exists vendor_jobs_status_idx
  on public.vendor_jobs (status, next_action_date);

create index if not exists vendor_jobs_asset_idx
  on public.vendor_jobs (asset_id) where asset_id is not null;

create index if not exists vendor_attachments_job_idx
  on public.vendor_attachments (vendor_job_id, created_at);

create index if not exists vendor_history_job_idx
  on public.vendor_history (vendor_job_id, created_at)
  where vendor_job_id is not null;

create index if not exists training_sessions_date_idx
  on public.training_sessions (session_date desc);

create index if not exists training_attendees_session_idx
  on public.training_attendees (session_id);

create index if not exists training_documents_session_idx
  on public.training_documents (session_id);

create index if not exists training_actions_session_idx
  on public.training_actions (session_id, status);

create index if not exists training_history_session_idx
  on public.training_history (session_id, created_at);

-- ------------------------------------------------------------------
-- Server-only access (RLS + revoke + deny policy, per table)
-- ------------------------------------------------------------------

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_history enable row level security;
alter table public.reorder_requests enable row level security;
alter table public.tools enable row level security;
alter table public.tool_loans enable row level security;
alter table public.assets enable row level security;
alter table public.asset_links enable row level security;
alter table public.asset_history enable row level security;
alter table public.refrigerant_logs enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_jobs enable row level security;
alter table public.vendor_attachments enable row level security;
alter table public.vendor_history enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_attendees enable row level security;
alter table public.training_documents enable row level security;
alter table public.training_actions enable row level security;
alter table public.training_history enable row level security;

-- Shop, vendor and training data is read and written exclusively by
-- authenticated server routes that enforce the access model v2 rules.
-- Browser clients get nothing directly.
revoke all on public.inventory_items from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;
revoke all on public.inventory_history from anon, authenticated;
revoke all on public.reorder_requests from anon, authenticated;
revoke all on public.tools from anon, authenticated;
revoke all on public.tool_loans from anon, authenticated;
revoke all on public.assets from anon, authenticated;
revoke all on public.asset_links from anon, authenticated;
revoke all on public.asset_history from anon, authenticated;
revoke all on public.refrigerant_logs from anon, authenticated;
revoke all on public.vendors from anon, authenticated;
revoke all on public.vendor_jobs from anon, authenticated;
revoke all on public.vendor_attachments from anon, authenticated;
revoke all on public.vendor_history from anon, authenticated;
revoke all on public.training_sessions from anon, authenticated;
revoke all on public.training_attendees from anon, authenticated;
revoke all on public.training_documents from anon, authenticated;
revoke all on public.training_actions from anon, authenticated;
revoke all on public.training_history from anon, authenticated;

create policy "inventory_items_server_only"
  on public.inventory_items for all to anon, authenticated using (false) with check (false);
create policy "inventory_movements_server_only"
  on public.inventory_movements for all to anon, authenticated using (false) with check (false);
create policy "inventory_history_server_only"
  on public.inventory_history for all to anon, authenticated using (false) with check (false);
create policy "reorder_requests_server_only"
  on public.reorder_requests for all to anon, authenticated using (false) with check (false);
create policy "tools_server_only"
  on public.tools for all to anon, authenticated using (false) with check (false);
create policy "tool_loans_server_only"
  on public.tool_loans for all to anon, authenticated using (false) with check (false);
create policy "assets_server_only"
  on public.assets for all to anon, authenticated using (false) with check (false);
create policy "asset_links_server_only"
  on public.asset_links for all to anon, authenticated using (false) with check (false);
create policy "asset_history_server_only"
  on public.asset_history for all to anon, authenticated using (false) with check (false);
create policy "refrigerant_logs_server_only"
  on public.refrigerant_logs for all to anon, authenticated using (false) with check (false);
create policy "vendors_server_only"
  on public.vendors for all to anon, authenticated using (false) with check (false);
create policy "vendor_jobs_server_only"
  on public.vendor_jobs for all to anon, authenticated using (false) with check (false);
create policy "vendor_attachments_server_only"
  on public.vendor_attachments for all to anon, authenticated using (false) with check (false);
create policy "vendor_history_server_only"
  on public.vendor_history for all to anon, authenticated using (false) with check (false);
create policy "training_sessions_server_only"
  on public.training_sessions for all to anon, authenticated using (false) with check (false);
create policy "training_attendees_server_only"
  on public.training_attendees for all to anon, authenticated using (false) with check (false);
create policy "training_documents_server_only"
  on public.training_documents for all to anon, authenticated using (false) with check (false);
create policy "training_actions_server_only"
  on public.training_actions for all to anon, authenticated using (false) with check (false);
create policy "training_history_server_only"
  on public.training_history for all to anon, authenticated using (false) with check (false);

-- Private file storage for vendor quotes, reports and evidence.
-- public = false means there is no anonymous URL for any file: the
-- server mints a short-lived signed URL only after checking the
-- requester's permissions.
insert into storage.buckets (id, name, public)
values ('vendors', 'vendors', false)
on conflict (id) do nothing;

-- Defense in depth: browser roles get no direct object access at all.
-- The application only ever touches objects through the server
-- (service role) and hands out signed URLs after a permission check.
create policy "vendors_bucket_server_only"
  on storage.objects
  for all
  to anon, authenticated
  using (false)
  with check (false);
