import { createAdminClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/time";
import { isBelowMinimum } from "@/lib/inventory-vendors-rules";
import {
  dateInRange,
  evidenceState,
  matchesQuery,
  sortTimeline,
  summarizeEvidence,
  unverifiedEntries,
  type EvidenceState,
  type ReportFilters,
  type ReportModule,
  type TimelineEntry,
} from "@/lib/reports-rules";

/**
 * Server-side data assembly for reports and audit dossiers (Phase 4).
 *
 * This module ONLY reads. It queries the tables the earlier phases built
 * and shapes them into one unified result; it never duplicates or copies
 * module data into report tables (there are none — Phase 4 needs no
 * migration). Every caller (the reports API route and the printable
 * report/dossier sheets) must pass the Phase 0 gate first: this module
 * assumes the caller already verified the account is approved.
 *
 * Scale note: The Darley has 228 units and a small team. Fetchers read at
 * most FETCH_LIMIT recent rows per module and apply the remaining filters
 * in memory (the same pattern the logbook list uses for text search), so
 * date ranges compare on the property's local calendar via localDate().
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

const FETCH_LIMIT = 500;

export type ReportResultItem = {
  module: ReportModule;
  id: number;
  ref: string;
  title: string;
  date: string;
  status: string | null;
  location: string | null;
  memberId: number | null;
  memberName: string | null;
  building: string | null;
  unit: string | null;
  evidence: EvidenceState | null;
  attachmentCount: number;
  verifiedByName: string | null;
  verifiedAt: string | null;
};

type FetchedRow = { item: ReportResultItem; csv: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Row shapes (only the columns this module reads)
// ---------------------------------------------------------------------------

type MemberLite = { id: number; name: string };

type LogEventRow = {
  id: number; folio: string; event_type: string; occurred_at: string;
  created_at: string; reported_by_member_id: number | null;
  building: string | null; unit: string | null; area: string | null;
  equipment: string | null; asset_id: number | null; description: string;
  findings: string | null; actions_taken: string | null;
  responsible_member_id: number | null; priority: string;
  follow_up_date: string | null; status: string; final_result: string | null;
  verified_by_member_id: number | null; verified_at: string | null;
  official_wo_ref: string | null;
};

type InspectionRow = {
  id: number; folio: string; template_name: string | null; title: string;
  building: string | null; unit: string | null; area: string | null;
  equipment: string | null; assigned_member_id: number | null;
  scheduled_date: string | null; status: string;
  completed_by_member_id: number | null; completed_at: string | null;
  created_at: string;
};

type CorrectiveRow = {
  id: number; inspection_id: number; description: string; status: string;
  responsible_member_id: number | null; due_date: string | null;
  work_order_id: number | null; log_event_id: number | null;
  completed_by_member_id: number | null; completed_at: string | null;
  verified_by_member_id: number | null; verified_at: string | null;
  created_at: string;
};

type WorkOrderRow = {
  id: number; title: string; description: string; area: string;
  category: string; priority: string; status: string;
  assigned_to: number | null; due_date: string | null;
  completion_comment: string | null; created_at: string; updated_at: string;
};

type InventoryItemRow = {
  id: number; name: string; color_category: string;
  quantity_on_hand: number | string; min_quantity: number | string;
  unit: string | null; supplier: string | null; location_zone: string | null;
  location_shelf: string | null; location_bin: string | null;
  notes: string | null; status: string;
  created_by_member_id: number | null; created_at: string;
};

type MovementRow = {
  id: number; item_id: number; movement_type: string;
  quantity: number | string; reason: string | null;
  work_order_id: number | null; log_event_id: number | null;
  actor_member_id: number | null; actor_email: string; created_at: string;
};

type ReorderRow = {
  id: number; item_id: number; quantity_requested: number | string;
  status: string; source: string; responsible_member_id: number | null;
  notes: string | null; ordered_by_member_id: number | null;
  ordered_at: string | null; received_by_member_id: number | null;
  received_at: string | null; created_at: string;
};

type ToolRow = {
  id: number; name: string; description: string | null;
  serial_number: string | null; status: string;
  current_holder_member_id: number | null; loaned_at: string | null;
  created_at: string;
};

type AssetRow = {
  id: number; name: string; asset_type: string | null;
  building: string | null; unit: string | null; area: string | null;
  brand: string | null; model: string | null; serial_number: string | null;
  installed_date: string | null; warranty_end_date: string | null;
  status: string; created_by_member_id: number | null; created_at: string;
};

type RefrigerantRow = {
  id: number; log_date: string; asset_id: number | null;
  equipment_text: string | null; refrigerant_type: string;
  amount_added: number | string; amount_recovered: number | string;
  amount_unit: string; technician_member_id: number | null;
  reason: string | null; work_order_id: number | null;
  log_event_id: number | null; created_at: string;
};

type VendorJobRow = {
  id: number; vendor_id: number; kind: string; title: string;
  description: string | null; status: string; scheduled_date: string | null;
  related_location: string | null; asset_id: number | null;
  equipment_text: string | null; responsible_member_id: number | null;
  next_action: string | null; next_action_date: string | null;
  work_order_id: number | null; log_event_id: number | null;
  completed_by_member_id: number | null; completed_at: string | null;
  verified_by_member_id: number | null; verified_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export async function memberNames(admin: AdminClient): Promise<Map<number, string>> {
  const { data, error } = await admin.from("members").select("id, name");
  if (error) throw error;
  return new Map(((data || []) as MemberLite[]).map((p) => [p.id, p.name]));
}

const nameOf = (names: Map<number, string>, id: number | null) =>
  id ? names.get(id) || null : null;

function locationOf(parts: (string | null | undefined)[]): string | null {
  const joined = parts.map((part) => (part || "").trim()).filter(Boolean).join(" · ");
  return joined || null;
}

async function countAttachments(
  admin: AdminClient,
  table: "log_attachments" | "inspection_attachments" | "vendor_attachments",
  key: "event_id" | "inspection_id" | "corrective_action_id" | "vendor_job_id",
  ids: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!ids.length) return counts;
  const { data, error } = await admin.from(table).select(key).in(key, ids);
  if (error) throw error;
  for (const row of (data || []) as unknown as Record<string, number>[]) {
    const id = row[key];
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

async function folioMap(
  admin: AdminClient,
  table: "log_events" | "inspections",
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await admin.from(table).select("id, folio").in("id", unique);
  if (error) throw error;
  for (const row of (data || []) as { id: number; folio: string }[]) map.set(row.id, row.folio);
  return map;
}

async function nameMap(
  admin: AdminClient,
  table: "inventory_items" | "assets" | "vendors",
  column: "name" | "company_name",
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await admin.from(table).select(`id, ${column}`).in("id", unique);
  if (error) throw error;
  for (const row of (data || []) as unknown as Record<string, unknown>[]) {
    map.set(Number(row.id), String(row[column] || ""));
  }
  return map;
}

/** Modules whose rows carry structured building/unit columns. */
const LOCATION_MODULES: ReportModule[] = ["logbook", "inspections", "assets"];

function locationBlocked(filters: ReportFilters, module: ReportModule): boolean {
  if (!filters.building && !filters.unit) return false;
  return !LOCATION_MODULES.includes(module);
}

// ---------------------------------------------------------------------------
// Row → unified item + CSV row converters (shared by search and dossiers)
// ---------------------------------------------------------------------------

function logEventFetched(row: LogEventRow, names: Map<number, string>, attachments: number): FetchedRow {
  const verifiedByName = nameOf(names, row.verified_by_member_id);
  const evidence = evidenceState({ attachmentCount: attachments, verifiedByName, verifiedAt: row.verified_at });
  const item: ReportResultItem = {
    module: "logbook", id: row.id, ref: row.folio, title: row.description,
    date: row.occurred_at, status: row.status,
    location: locationOf([row.building, row.unit, row.area, row.equipment]),
    memberId: row.responsible_member_id, memberName: nameOf(names, row.responsible_member_id),
    building: row.building, unit: row.unit, evidence, attachmentCount: attachments,
    verifiedByName, verifiedAt: row.verified_at,
  };
  const csv = {
    id: row.id, folio: row.folio, occurredAt: row.occurred_at, registeredAt: row.created_at,
    type: row.event_type, status: row.status, priority: row.priority,
    building: row.building, unit: row.unit, area: row.area, equipment: row.equipment,
    description: row.description, reportedBy: nameOf(names, row.reported_by_member_id),
    responsible: nameOf(names, row.responsible_member_id), followUpDate: row.follow_up_date,
    finalResult: row.final_result, attachments, evidenceState: evidence,
    verifiedBy: verifiedByName, verifiedAt: row.verified_at, officialWoRef: row.official_wo_ref,
  };
  return { item, csv };
}

function inspectionFetched(row: InspectionRow, names: Map<number, string>, attachments: number): FetchedRow {
  // Inspections have evidence (photos) but no verification act of their
  // own — verification lives on their corrective actions. So an inspection
  // is never reported as "verified" here; that is deliberate honesty.
  const evidence = evidenceState({ attachmentCount: attachments, verifiedByName: null, verifiedAt: null });
  const item: ReportResultItem = {
    module: "inspections", id: row.id, ref: row.folio, title: row.title,
    date: row.created_at, status: row.status,
    location: locationOf([row.building, row.unit, row.area, row.equipment]),
    memberId: row.assigned_member_id, memberName: nameOf(names, row.assigned_member_id),
    building: row.building, unit: row.unit, evidence, attachmentCount: attachments,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, folio: row.folio, createdAt: row.created_at, title: row.title,
    template: row.template_name, status: row.status, building: row.building,
    unit: row.unit, area: row.area, equipment: row.equipment,
    assignedTo: nameOf(names, row.assigned_member_id), scheduledDate: row.scheduled_date,
    completedBy: nameOf(names, row.completed_by_member_id), completedAt: row.completed_at,
    attachments, evidenceState: evidence,
  };
  return { item, csv };
}

function correctiveFetched(
  row: CorrectiveRow, names: Map<number, string>, attachments: number,
  inspectionFolio: string | null, logEventFolio: string | null,
): FetchedRow {
  const verifiedByName = nameOf(names, row.verified_by_member_id);
  const evidence = evidenceState({ attachmentCount: attachments, verifiedByName, verifiedAt: row.verified_at });
  const item: ReportResultItem = {
    module: "corrective", id: row.id, ref: `#${row.id}`, title: row.description,
    date: row.created_at, status: row.status, location: null,
    memberId: row.responsible_member_id, memberName: nameOf(names, row.responsible_member_id),
    building: null, unit: null, evidence, attachmentCount: attachments,
    verifiedByName, verifiedAt: row.verified_at,
  };
  const csv = {
    id: row.id, createdAt: row.created_at, inspectionFolio, description: row.description,
    status: row.status, responsible: nameOf(names, row.responsible_member_id),
    dueDate: row.due_date, completedBy: nameOf(names, row.completed_by_member_id),
    completedAt: row.completed_at, attachments, evidenceState: evidence,
    verifiedBy: verifiedByName, verifiedAt: row.verified_at,
    workOrderId: row.work_order_id, logEventFolio,
  };
  return { item, csv };
}

function workOrderFetched(row: WorkOrderRow, names: Map<number, string>): FetchedRow {
  const item: ReportResultItem = {
    module: "work_orders", id: row.id, ref: `#${row.id}`, title: row.title,
    date: row.created_at, status: row.status, location: row.area || null,
    memberId: row.assigned_to, memberName: nameOf(names, row.assigned_to),
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, createdAt: row.created_at, title: row.title, area: row.area,
    category: row.category, priority: row.priority, status: row.status,
    assignedTo: nameOf(names, row.assigned_to), dueDate: row.due_date,
    completionComment: row.completion_comment,
  };
  return { item, csv };
}

function inventoryFetched(row: InventoryItemRow, names: Map<number, string>): FetchedRow {
  const location = locationOf([row.location_zone, row.location_shelf, row.location_bin]);
  const below = isBelowMinimum({ quantity_on_hand: Number(row.quantity_on_hand), min_quantity: Number(row.min_quantity), status: row.status });
  const item: ReportResultItem = {
    module: "inventory", id: row.id, ref: `#${row.id}`, title: row.name,
    date: row.created_at, status: row.status, location,
    memberId: row.created_by_member_id, memberName: nameOf(names, row.created_by_member_id),
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, name: row.name, colorCategory: row.color_category,
    quantityOnHand: Number(row.quantity_on_hand), minQuantity: Number(row.min_quantity),
    belowMinimum: below ? "yes" : "no", unit: row.unit, supplier: row.supplier,
    location, status: row.status,
  };
  return { item, csv };
}

function movementFetched(row: MovementRow, names: Map<number, string>, itemName: string | null, logEventFolio: string | null): FetchedRow {
  const item: ReportResultItem = {
    module: "movements", id: row.id, ref: `#${row.id}`,
    title: `${itemName || "Item"} — ${row.movement_type} ${Number(row.quantity)}`,
    date: row.created_at, status: row.movement_type, location: null,
    memberId: row.actor_member_id, memberName: nameOf(names, row.actor_member_id),
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, createdAt: row.created_at, item: itemName, type: row.movement_type,
    quantity: Number(row.quantity), reason: row.reason, actor: nameOf(names, row.actor_member_id) || row.actor_email,
    workOrderId: row.work_order_id, logEventFolio,
  };
  return { item, csv };
}

function reorderFetched(row: ReorderRow, names: Map<number, string>, itemName: string | null): FetchedRow {
  const item: ReportResultItem = {
    module: "reorders", id: row.id, ref: `#${row.id}`,
    title: `${itemName || "Item"} — ${Number(row.quantity_requested)} requested`,
    date: row.created_at, status: row.status, location: null,
    memberId: row.responsible_member_id, memberName: nameOf(names, row.responsible_member_id),
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, createdAt: row.created_at, item: itemName,
    quantityRequested: Number(row.quantity_requested), status: row.status, source: row.source,
    responsible: nameOf(names, row.responsible_member_id),
    orderedBy: nameOf(names, row.ordered_by_member_id), orderedAt: row.ordered_at,
    receivedBy: nameOf(names, row.received_by_member_id), receivedAt: row.received_at,
  };
  return { item, csv };
}

function toolFetched(row: ToolRow, names: Map<number, string>): FetchedRow {
  const holder = nameOf(names, row.current_holder_member_id);
  const item: ReportResultItem = {
    module: "tools", id: row.id, ref: `#${row.id}`, title: row.name,
    date: row.loaned_at || row.created_at, status: row.status, location: null,
    memberId: row.current_holder_member_id, memberName: holder,
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, name: row.name, serialNumber: row.serial_number, status: row.status,
    currentHolder: holder, loanedAt: row.loaned_at,
  };
  return { item, csv };
}

function assetFetched(row: AssetRow, names: Map<number, string>): FetchedRow {
  const item: ReportResultItem = {
    module: "assets", id: row.id, ref: `#${row.id}`, title: row.name,
    date: row.created_at, status: row.status,
    location: locationOf([row.building, row.unit, row.area]),
    memberId: row.created_by_member_id, memberName: nameOf(names, row.created_by_member_id),
    building: row.building, unit: row.unit, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, name: row.name, type: row.asset_type, building: row.building,
    unit: row.unit, area: row.area, brand: row.brand, model: row.model,
    serialNumber: row.serial_number, installedDate: row.installed_date,
    warrantyEndDate: row.warranty_end_date, status: row.status,
  };
  return { item, csv };
}

function refrigerantFetched(row: RefrigerantRow, names: Map<number, string>, assetName: string | null): FetchedRow {
  const equipment = assetName || row.equipment_text;
  const item: ReportResultItem = {
    module: "refrigerant", id: row.id, ref: `#${row.id}`,
    title: `${row.refrigerant_type} — ${equipment || "equipment"}`,
    date: row.log_date, status: null, location: null,
    memberId: row.technician_member_id, memberName: nameOf(names, row.technician_member_id),
    building: null, unit: null, evidence: null, attachmentCount: 0,
    verifiedByName: null, verifiedAt: null,
  };
  const csv = {
    id: row.id, logDate: row.log_date, asset: assetName, equipment: row.equipment_text,
    refrigerantType: row.refrigerant_type, amountAdded: Number(row.amount_added),
    amountRecovered: Number(row.amount_recovered), amountUnit: row.amount_unit,
    technician: nameOf(names, row.technician_member_id), reason: row.reason,
  };
  return { item, csv };
}

function vendorJobFetched(row: VendorJobRow, names: Map<number, string>, attachments: number, company: string | null): FetchedRow {
  const verifiedByName = nameOf(names, row.verified_by_member_id);
  const evidence = evidenceState({ attachmentCount: attachments, verifiedByName, verifiedAt: row.verified_at });
  const item: ReportResultItem = {
    module: "vendors", id: row.id, ref: `#${row.id}`,
    title: `${company ? `${company} — ` : ""}${row.title}`,
    date: row.created_at, status: row.status, location: row.related_location,
    memberId: row.responsible_member_id, memberName: nameOf(names, row.responsible_member_id),
    building: null, unit: null, evidence, attachmentCount: attachments,
    verifiedByName, verifiedAt: row.verified_at,
  };
  const csv = {
    id: row.id, createdAt: row.created_at, vendor: company, kind: row.kind,
    title: row.title, status: row.status, relatedLocation: row.related_location,
    responsible: nameOf(names, row.responsible_member_id), nextAction: row.next_action,
    nextActionDate: row.next_action_date, attachments, evidenceState: evidence,
    completedBy: nameOf(names, row.completed_by_member_id), completedAt: row.completed_at,
    verifiedBy: verifiedByName, verifiedAt: row.verified_at,
  };
  return { item, csv };
}

// ---------------------------------------------------------------------------
// Filtered search — one fetcher per module
// ---------------------------------------------------------------------------

async function fetchLogbook(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  let query = admin.from("log_events").select("*").order("occurred_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.building) query = query.eq("building", filters.building);
  if (filters.unit) query = query.eq("unit", filters.unit);
  if (filters.memberId) {
    query = query.or(`responsible_member_id.eq.${filters.memberId},reported_by_member_id.eq.${filters.memberId}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as LogEventRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.occurred_at), filters) &&
    matchesQuery(filters.q, [row.folio, row.building, row.unit, row.area, row.equipment, row.description, row.official_wo_ref]));
  const counts = await countAttachments(admin, "log_attachments", "event_id", rows.map((row) => row.id));
  return rows.map((row) => logEventFetched(row, names, counts.get(row.id) || 0));
}

async function fetchInspections(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  let query = admin.from("inspections").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.building) query = query.eq("building", filters.building);
  if (filters.unit) query = query.eq("unit", filters.unit);
  if (filters.memberId) query = query.eq("assigned_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as InspectionRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [row.folio, row.title, row.template_name, row.building, row.unit, row.area, row.equipment]));
  const counts = await countAttachments(admin, "inspection_attachments", "inspection_id", rows.map((row) => row.id));
  return rows.map((row) => inspectionFetched(row, names, counts.get(row.id) || 0));
}

async function fetchCorrective(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "corrective")) return [];
  let query = admin.from("corrective_actions").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.memberId) query = query.eq("responsible_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as CorrectiveRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) && matchesQuery(filters.q, [row.description]));
  const [counts, inspFolios, logFolios] = await Promise.all([
    countAttachments(admin, "inspection_attachments", "corrective_action_id", rows.map((row) => row.id)),
    folioMap(admin, "inspections", rows.map((row) => row.inspection_id)),
    folioMap(admin, "log_events", rows.map((row) => row.log_event_id || 0)),
  ]);
  return rows.map((row) => correctiveFetched(row, names, counts.get(row.id) || 0, inspFolios.get(row.inspection_id) || null, row.log_event_id ? logFolios.get(row.log_event_id) || null : null));
}

async function fetchWorkOrders(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "work_orders")) return [];
  let query = admin.from("work_orders").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.memberId) query = query.eq("assigned_to", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as WorkOrderRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [row.id, row.title, row.description, row.area, row.category]));
  return rows.map((row) => workOrderFetched(row, names));
}

async function fetchInventory(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "inventory")) return [];
  let query = admin.from("inventory_items").select("*").order("name", { ascending: true }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.memberId) query = query.eq("created_by_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as InventoryItemRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    (!filters.lowStockOnly || isBelowMinimum({ quantity_on_hand: Number(row.quantity_on_hand), min_quantity: Number(row.min_quantity), status: row.status })) &&
    matchesQuery(filters.q, [row.name, row.supplier, row.location_zone, row.location_shelf, row.location_bin, row.notes]));
  return rows.map((row) => inventoryFetched(row, names));
}

async function fetchMovements(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "movements")) return [];
  // Movements have no status column (they have a type); the status filter
  // does not apply to this module and is ignored — documented behavior.
  let query = admin.from("inventory_movements").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.memberId) query = query.eq("actor_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as MovementRow[];
  const itemNames = await nameMap(admin, "inventory_items", "name", rows.map((row) => row.item_id));
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [itemNames.get(row.item_id), row.reason, row.movement_type]));
  const logFolios = await folioMap(admin, "log_events", rows.map((row) => row.log_event_id || 0));
  return rows.map((row) => movementFetched(row, names, itemNames.get(row.item_id) || null, row.log_event_id ? logFolios.get(row.log_event_id) || null : null));
}

async function fetchReorders(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "reorders")) return [];
  let query = admin.from("reorder_requests").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.memberId) query = query.eq("responsible_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as ReorderRow[];
  const itemNames = await nameMap(admin, "inventory_items", "name", rows.map((row) => row.item_id));
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [itemNames.get(row.item_id), row.notes]));
  return rows.map((row) => reorderFetched(row, names, itemNames.get(row.item_id) || null));
}

async function fetchTools(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "tools")) return [];
  // The audit question for tools is "what is out, and with whom": without
  // an explicit status filter this module returns ACTIVE LOANS only.
  let query = admin.from("tools").select("*").order("loaned_at", { ascending: false, nullsFirst: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  else query = query.eq("status", "loaned");
  if (filters.memberId) query = query.eq("current_holder_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as ToolRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.loaned_at || row.created_at), filters) &&
    matchesQuery(filters.q, [row.name, row.description, row.serial_number]));
  return rows.map((row) => toolFetched(row, names));
}

async function fetchAssets(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  let query = admin.from("assets").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.building) query = query.eq("building", filters.building);
  if (filters.unit) query = query.eq("unit", filters.unit);
  if (filters.memberId) query = query.eq("created_by_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as AssetRow[];
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [row.name, row.asset_type, row.brand, row.model, row.serial_number, row.building, row.unit, row.area]));
  return rows.map((row) => assetFetched(row, names));
}

async function fetchRefrigerant(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "refrigerant")) return [];
  // Refrigerant rows carry no status column; the status filter does not
  // apply to this module and is ignored — documented behavior.
  let query = admin.from("refrigerant_logs").select("*").order("log_date", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.from) query = query.gte("log_date", filters.from);
  if (filters.to) query = query.lte("log_date", filters.to);
  if (filters.memberId) query = query.eq("technician_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as RefrigerantRow[];
  const assetNames = await nameMap(admin, "assets", "name", rows.map((row) => row.asset_id || 0));
  rows = rows.filter((row) =>
    matchesQuery(filters.q, [row.refrigerant_type, row.equipment_text, assetNames.get(row.asset_id || 0), row.reason]));
  return rows.map((row) => refrigerantFetched(row, names, row.asset_id ? assetNames.get(row.asset_id) || null : null));
}

async function fetchVendors(admin: AdminClient, filters: ReportFilters, names: Map<number, string>): Promise<FetchedRow[]> {
  if (locationBlocked(filters, "vendors")) return [];
  let query = admin.from("vendor_jobs").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.memberId) query = query.eq("responsible_member_id", filters.memberId);
  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []) as VendorJobRow[];
  const companies = await nameMap(admin, "vendors", "company_name", rows.map((row) => row.vendor_id));
  rows = rows.filter((row) =>
    dateInRange(localDate(row.created_at), filters) &&
    matchesQuery(filters.q, [companies.get(row.vendor_id), row.title, row.description, row.related_location, row.equipment_text, row.kind]));
  const counts = await countAttachments(admin, "vendor_attachments", "vendor_job_id", rows.map((row) => row.id));
  return rows.map((row) => vendorJobFetched(row, names, counts.get(row.id) || 0, companies.get(row.vendor_id) || null));
}

const FETCHERS: Record<ReportModule, (admin: AdminClient, filters: ReportFilters, names: Map<number, string>) => Promise<FetchedRow[]>> = {
  logbook: fetchLogbook,
  inspections: fetchInspections,
  corrective: fetchCorrective,
  work_orders: fetchWorkOrders,
  inventory: fetchInventory,
  movements: fetchMovements,
  reorders: fetchReorders,
  tools: fetchTools,
  assets: fetchAssets,
  refrigerant: fetchRefrigerant,
  vendors: fetchVendors,
};

export type ReportSearch = {
  counts: Record<ReportModule, number>;
  total: number;
  groups: { module: ReportModule; items: ReportResultItem[] }[];
};

/** Filtered cross-module search with per-module counts. */
export async function searchReports(
  admin: AdminClient,
  filters: ReportFilters,
  names: Map<number, string>,
): Promise<ReportSearch> {
  const modules = filters.module === "all" ? Object.keys(FETCHERS) as ReportModule[] : [filters.module];
  const counts = {} as Record<ReportModule, number>;
  const groups: ReportSearch["groups"] = [];
  let total = 0;
  for (const key of Object.keys(FETCHERS) as ReportModule[]) counts[key] = 0;
  for (const key of modules) {
    const fetched = await FETCHERS[key](admin, filters, names);
    counts[key] = fetched.length;
    total += fetched.length;
    if (fetched.length) groups.push({ module: key, items: fetched.map((row) => row.item) });
  }
  return { counts, total, groups };
}

/** Full keyed rows for the CSV export of ONE module, same filters. */
export async function fetchCsvRows(
  admin: AdminClient,
  module: ReportModule,
  filters: ReportFilters,
  names: Map<number, string>,
): Promise<Record<string, unknown>[]> {
  const fetched = await FETCHERS[module](admin, { ...filters, module }, names);
  return fetched.map((row) => row.csv);
}

// ---------------------------------------------------------------------------
// Dossiers (expedientes)
// ---------------------------------------------------------------------------

export type Dossier = {
  kind: "case" | "unit";
  title: string;
  seedEvent: {
    id: number; folio: string; occurredAt: string; type: string;
    status: string; description: string; officialWoRef: string | null;
  } | null;
  unit: string | null;
  building: string | null;
  officialRefs: string[];
  entries: TimelineEntry[];
  summary: ReturnType<typeof summarizeEvidence>;
  unverified: TimelineEntry[];
};

const KIND_BY_MODULE: Record<string, TimelineEntry["kind"]> = {
  logbook: "log_event",
  inspections: "inspection",
  corrective: "corrective_action",
  work_orders: "work_order",
  vendors: "vendor_job",
  refrigerant: "refrigerant",
  movements: "inventory_movement",
  assets: "asset",
};

function toEntry(fetched: FetchedRow, detail: string | null): TimelineEntry {
  const { item } = fetched;
  return {
    kind: KIND_BY_MODULE[item.module],
    id: item.id,
    ref: item.ref,
    date: item.date,
    title: item.title,
    status: item.status,
    detail,
    evidence: item.evidence,
    attachmentCount: item.attachmentCount,
    verifiedByName: item.verifiedByName,
    verifiedAt: item.verifiedAt,
  };
}

function finishDossier(base: Omit<Dossier, "entries" | "summary" | "unverified">, entries: TimelineEntry[]): Dossier {
  const sorted = sortTimeline(entries);
  return {
    ...base,
    entries: sorted,
    summary: summarizeEvidence(sorted),
    unverified: unverifiedEntries(sorted),
  };
}

async function getLogEvent(admin: AdminClient, id: number): Promise<LogEventRow | null> {
  const { data, error } = await admin.from("log_events").select("*").eq("id", id).maybeSingle<LogEventRow>();
  if (error) throw error;
  return data;
}

/** Case-chain traversal in BOTH directions over log_event_links. */
async function traverseChain(admin: AdminClient, seedId: number): Promise<Set<number>> {
  const chainIds = new Set<number>([seedId]);
  let frontier = [seedId];
  for (let step = 0; step < 20 && frontier.length; step += 1) {
    const { data, error } = await admin
      .from("log_event_links")
      .select("event_id, related_event_id")
      .or(`event_id.in.(${frontier.join(",")}),related_event_id.in.(${frontier.join(",")})`);
    if (error) throw error;
    const next: number[] = [];
    for (const link of (data || []) as { event_id: number; related_event_id: number }[]) {
      for (const candidate of [link.event_id, link.related_event_id]) {
        if (!chainIds.has(candidate)) {
          chainIds.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
    if (chainIds.size > 100) break;
  }
  return chainIds;
}

async function rowsByIds<T>(admin: AdminClient, table: string, ids: number[]): Promise<T[]> {
  if (!ids.length) return [];
  const { data, error } = await admin.from(table).select("*").in("id", ids);
  if (error) throw error;
  return (data || []) as T[];
}

/**
 * Gathers everything tied to a set of logbook events: their corrective
 * actions (and the inspections and work orders behind them), vendor jobs,
 * refrigerant records, inventory movements and related assets — the same
 * gathering used by both the case dossier and the unit dossier.
 */
async function gatherAroundEvents(
  admin: AdminClient,
  events: LogEventRow[],
  names: Map<number, string>,
  extraInspections: InspectionRow[] = [],
  extraAssets: AssetRow[] = [],
): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  const eventIds = events.map((event) => event.id);
  const eventCounts = await countAttachments(admin, "log_attachments", "event_id", eventIds);
  const { data: commentRows } = eventIds.length
    ? await admin.from("log_comments").select("event_id").in("event_id", eventIds)
    : { data: [] as { event_id: number }[] };
  const commentCounts = new Map<number, number>();
  for (const row of (commentRows || []) as { event_id: number }[]) {
    commentCounts.set(row.event_id, (commentCounts.get(row.event_id) || 0) + 1);
  }
  for (const event of events) {
    const comments = commentCounts.get(event.id) || 0;
    const detailParts = [event.final_result || event.actions_taken || event.findings || null];
    if (comments) detailParts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
    if (event.official_wo_ref) detailParts.push(`Official WO: ${event.official_wo_ref}`);
    entries.push(toEntry(logEventFetched(event, names, eventCounts.get(event.id) || 0), detailParts.filter(Boolean).join(" · ") || null));
  }

  const workOrderIds = new Set<number>();
  const assetIds = new Set<number>(extraAssets.map((asset) => asset.id));
  for (const event of events) if (event.asset_id) assetIds.add(event.asset_id);

  // Corrective actions tied to the events, plus the ones of any extra
  // inspections (unit dossier), and the inspections behind them.
  const inspectionIds = new Set<number>(extraInspections.map((row) => row.id));
  let corrective: CorrectiveRow[] = [];
  if (eventIds.length) {
    const { data, error } = await admin.from("corrective_actions").select("*").in("log_event_id", eventIds);
    if (error) throw error;
    corrective = (data || []) as CorrectiveRow[];
  }
  if (extraInspections.length) {
    const { data, error } = await admin.from("corrective_actions").select("*").in("inspection_id", extraInspections.map((row) => row.id));
    if (error) throw error;
    const seen = new Set(corrective.map((row) => row.id));
    for (const row of (data || []) as CorrectiveRow[]) if (!seen.has(row.id)) corrective.push(row);
  }
  for (const row of corrective) {
    inspectionIds.add(row.inspection_id);
    if (row.work_order_id) workOrderIds.add(row.work_order_id);
  }
  const inspections = await rowsByIds<InspectionRow>(admin, "inspections", [...inspectionIds]);
  const inspCounts = await countAttachments(admin, "inspection_attachments", "inspection_id", inspections.map((row) => row.id));
  const inspFolios = new Map(inspections.map((row) => [row.id, row.folio]));
  const eventFolios = new Map(events.map((row) => [row.id, row.folio]));
  for (const row of inspections) {
    entries.push(toEntry(inspectionFetched(row, names, inspCounts.get(row.id) || 0), row.template_name));
  }
  const corrCounts = await countAttachments(admin, "inspection_attachments", "corrective_action_id", corrective.map((row) => row.id));
  for (const row of corrective) {
    entries.push(toEntry(
      correctiveFetched(row, names, corrCounts.get(row.id) || 0, inspFolios.get(row.inspection_id) || null, row.log_event_id ? eventFolios.get(row.log_event_id) || null : null),
      row.due_date ? `Due ${row.due_date}` : null,
    ));
  }

  // Vendor jobs tied to the events.
  if (eventIds.length) {
    const { data, error } = await admin.from("vendor_jobs").select("*").in("log_event_id", eventIds);
    if (error) throw error;
    const jobs = (data || []) as VendorJobRow[];
    const companies = await nameMap(admin, "vendors", "company_name", jobs.map((row) => row.vendor_id));
    const jobCounts = await countAttachments(admin, "vendor_attachments", "vendor_job_id", jobs.map((row) => row.id));
    for (const row of jobs) {
      if (row.work_order_id) workOrderIds.add(row.work_order_id);
      if (row.asset_id) assetIds.add(row.asset_id);
      entries.push(toEntry(vendorJobFetched(row, names, jobCounts.get(row.id) || 0, companies.get(row.vendor_id) || null), row.next_action ? `Next: ${row.next_action}` : null));
    }
  }

  // Refrigerant records tied to the events or to the gathered assets.
  {
    let byEvent: unknown[] = [];
    if (eventIds.length) {
      const { data, error } = await admin.from("refrigerant_logs").select("*").in("log_event_id", eventIds);
      if (error) throw error;
      byEvent = data || [];
    }
    let byAsset: unknown[] = [];
    if (assetIds.size) {
      const { data, error } = await admin.from("refrigerant_logs").select("*").in("asset_id", [...assetIds]);
      if (error) throw error;
      byAsset = data || [];
    }
    const seen = new Set<number>();
    const rows: RefrigerantRow[] = [];
    for (const row of [...byEvent, ...byAsset] as RefrigerantRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    const assetNames = await nameMap(admin, "assets", "name", rows.map((row) => row.asset_id || 0));
    for (const row of rows) {
      if (row.work_order_id) workOrderIds.add(row.work_order_id);
      if (row.asset_id) assetIds.add(row.asset_id);
      entries.push(toEntry(refrigerantFetched(row, names, row.asset_id ? assetNames.get(row.asset_id) || null : null), row.reason));
    }
  }

  // Inventory movements tied to the events.
  if (eventIds.length) {
    const { data, error } = await admin.from("inventory_movements").select("*").in("log_event_id", eventIds);
    if (error) throw error;
    const rows = (data || []) as MovementRow[];
    const itemNames = await nameMap(admin, "inventory_items", "name", rows.map((row) => row.item_id));
    for (const row of rows) {
      if (row.work_order_id) workOrderIds.add(row.work_order_id);
      entries.push(toEntry(movementFetched(row, names, itemNames.get(row.item_id) || null, eventFolios.get(row.log_event_id || 0) || null), row.reason));
    }
  }

  // Work orders gathered from every link above.
  const workOrders = await rowsByIds<WorkOrderRow>(admin, "work_orders", [...workOrderIds]);
  for (const row of workOrders) entries.push(toEntry(workOrderFetched(row, names), row.completion_comment));

  // Assets related to the case.
  const assets = await rowsByIds<AssetRow>(admin, "assets", [...assetIds]);
  for (const row of assets) entries.push(toEntry(assetFetched(row, names), locationOf([row.brand, row.model, row.serial_number])));

  return entries;
}

/** Case dossier: the full chain of one logbook case, chronologically. */
export async function buildCaseDossier(
  admin: AdminClient,
  seedEventId: number,
  names: Map<number, string>,
): Promise<Dossier | null> {
  const seed = await getLogEvent(admin, seedEventId);
  if (!seed) return null;
  const chainIds = await traverseChain(admin, seedEventId);
  const events = await rowsByIds<LogEventRow>(admin, "log_events", [...chainIds]);
  const entries = await gatherAroundEvents(admin, events, names);
  const officialRefs = [...new Set(events.map((event) => event.official_wo_ref).filter(Boolean))] as string[];
  return finishDossier(
    {
      kind: "case",
      title: seed.folio,
      seedEvent: {
        id: seed.id, folio: seed.folio, occurredAt: seed.occurred_at,
        type: seed.event_type, status: seed.status,
        description: seed.description, officialWoRef: seed.official_wo_ref,
      },
      unit: seed.unit,
      building: seed.building,
      officialRefs,
    },
    entries,
  );
}

/** Apartment dossier: everything recorded for one unit, chronologically. */
export async function buildUnitDossier(
  admin: AdminClient,
  unit: string,
  building: string | null,
  names: Map<number, string>,
): Promise<Dossier> {
  let eventQuery = admin.from("log_events").select("*").eq("unit", unit).order("occurred_at", { ascending: true }).limit(FETCH_LIMIT);
  if (building) eventQuery = eventQuery.eq("building", building);
  const { data: eventRows, error: eventError } = await eventQuery;
  if (eventError) throw eventError;
  const events = (eventRows || []) as LogEventRow[];

  let inspQuery = admin.from("inspections").select("*").eq("unit", unit).limit(FETCH_LIMIT);
  if (building) inspQuery = inspQuery.eq("building", building);
  const { data: inspRows, error: inspError } = await inspQuery;
  if (inspError) throw inspError;
  const inspections = (inspRows || []) as InspectionRow[];

  let assetQuery = admin.from("assets").select("*").eq("unit", unit).limit(FETCH_LIMIT);
  if (building) assetQuery = assetQuery.eq("building", building);
  const { data: assetRows, error: assetError } = await assetQuery;
  if (assetError) throw assetError;
  const assets = (assetRows || []) as AssetRow[];

  const entries = await gatherAroundEvents(admin, events, names, inspections, assets);

  // Work orders and vendor jobs reference the unit as free text
  // ("Unit / Area" / related location): matched by containment and
  // documented as such — they are gathered, never silently merged.
  const like = `%${unit.replace(/[%_\\]/g, "")}%`;
  const { data: woRows } = await admin.from("work_orders").select("*").ilike("area", like).limit(FETCH_LIMIT);
  const seenWo = new Set(entries.filter((e) => e.kind === "work_order").map((e) => e.id));
  for (const row of (woRows || []) as WorkOrderRow[]) {
    if (!seenWo.has(row.id)) entries.push(toEntry(workOrderFetched(row, names), row.completion_comment));
  }
  const { data: jobRows } = await admin.from("vendor_jobs").select("*").ilike("related_location", like).limit(FETCH_LIMIT);
  const seenJobs = new Set(entries.filter((e) => e.kind === "vendor_job").map((e) => e.id));
  const jobs = ((jobRows || []) as VendorJobRow[]).filter((row) => !seenJobs.has(row.id));
  if (jobs.length) {
    const companies = await nameMap(admin, "vendors", "company_name", jobs.map((row) => row.vendor_id));
    const jobCounts = await countAttachments(admin, "vendor_attachments", "vendor_job_id", jobs.map((row) => row.id));
    for (const row of jobs) {
      entries.push(toEntry(vendorJobFetched(row, names, jobCounts.get(row.id) || 0, companies.get(row.vendor_id) || null), row.next_action ? `Next: ${row.next_action}` : null));
    }
  }

  const officialRefs = [...new Set(events.map((event) => event.official_wo_ref).filter(Boolean))] as string[];
  return finishDossier(
    {
      kind: "unit",
      title: building ? `${building} · Unit ${unit}` : `Unit ${unit}`,
      seedEvent: null,
      unit,
      building,
      officialRefs,
    },
    entries,
  );
}
