/**
 * Pure authorization and domain rules for Phase 3B: shop inventory,
 * tools, assets, refrigerant records, vendors and training.
 *
 * Like lib/inspections-rules.ts, this module is intentionally free of
 * imports and side effects so the exact decisions the server makes can
 * be exercised by the verification suite
 * (scripts/verify-inventory-vendors.mjs) without a database. The
 * approval primitives intentionally mirror lib/access-rules.ts
 * (isApprovedAccess); the suite asserts both modules agree on every
 * account state so they cannot silently drift apart.
 *
 * Model summary (extends access model v2, it never replaces it):
 * - Shop, vendors and training are OPERATIONAL modules. An account is
 *   operational when approval_status = 'approved' AND active = true.
 *   Unapproved accounts get nothing: no lists, no details, no
 *   downloads (403).
 * - Every operational account has the SAME permissions: record stock
 *   movements, raise and process reorder requests, loan and return
 *   tools, register assets and refrigerant use, work the vendor
 *   directory and its pending jobs, and record training sessions.
 *   Administration (is_admin) grants nothing extra here, and
 *   `job_title` and the legacy `role` grant nothing at all. The SOP
 *   5025 color categories are FIXED constants from Jose's list (the
 *   system does not make them configurable, so there is nothing
 *   structural for an administrator to edit in this phase).
 * - Ledgers and histories are APPEND-ONLY: stock movements, tool
 *   loans, refrigerant records and every history table are only ever
 *   inserted by the server. Stock on hand changes only together with
 *   a movement row — there is no silent stock edit anywhere.
 * - Items, tools, vendors and assets are archived / retired, never
 *   deleted through the app.
 */

export type Phase3BApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type Phase3BAccessFields = {
  approval_status: Phase3BApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

/* ------------------------------------------------------------------ */
/* SOP 5025 color categories — exactly as Jose shared them.           */
/* These keys are fixed system constants: the app does not edit them, */
/* and nothing in the system re-labels them as anything else.         */
/* ------------------------------------------------------------------ */

export type SopColorKey =
  | "paint_chemicals"
  | "cleaning"
  | "construction"
  | "hardware"
  | "lighting"
  | "appliances"
  | "electrical"
  | "plumbing"
  | "hvac"
  | "safety";

export const SOP_COLOR_CATEGORIES: {
  key: SopColorKey; colorEn: string; colorEs: string; en: string; es: string;
}[] = [
  { key: "paint_chemicals", colorEn: "Yellow", colorEs: "Amarillo", en: "Paints & chemicals", es: "Pinturas y químicos" },
  { key: "cleaning", colorEn: "Dark green", colorEs: "Verde oscuro", en: "Cleaning", es: "Limpieza" },
  { key: "construction", colorEn: "Brown", colorEs: "Marrón", en: "Construction materials", es: "Materiales de construcción" },
  { key: "hardware", colorEn: "Orange", colorEs: "Naranja", en: "Hardware", es: "Hardware / herrajes" },
  { key: "lighting", colorEn: "Maroon", colorEs: "Granate", en: "Lighting", es: "Iluminación" },
  { key: "appliances", colorEn: "White", colorEs: "Blanco", en: "Appliances", es: "Electrodomésticos" },
  { key: "electrical", colorEn: "Green", colorEs: "Verde", en: "Electrical", es: "Electricidad" },
  { key: "plumbing", colorEn: "Blue", colorEs: "Azul", en: "Plumbing", es: "Plomería" },
  { key: "hvac", colorEn: "Red", colorEs: "Rojo", en: "HVAC", es: "HVAC" },
  { key: "safety", colorEn: "Yellow (safety wall)", colorEs: "Amarillo (muro de seguridad)", en: "Safety", es: "Seguridad" },
];

export const SOP_COLOR_KEYS: SopColorKey[] = SOP_COLOR_CATEGORIES.map((row) => row.key);

export function sopColorCategory(key: string) {
  return SOP_COLOR_CATEGORIES.find((row) => row.key === key) || null;
}

/** "Blue — Plumbing" / "Azul — Plomería" for lists and print formats. */
export function sopColorLabel(key: string, lang: "en" | "es"): string {
  const row = sopColorCategory(key);
  if (!row) return key;
  return lang === "es" ? `${row.colorEs} — ${row.es}` : `${row.colorEn} — ${row.en}`;
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** Mirror of isApprovedAccess in lib/access-rules.ts. Keep in sync. */
export function isPhase3BOperational(member: Phase3BAccessFields | null | undefined): boolean {
  return !!member && member.active === true && member.approval_status === "approved";
}

/** The single gate for the whole phase: every list, detail and file. */
export function canAccessShop(member: Phase3BAccessFields): boolean {
  return isPhase3BOperational(member);
}

export function canAccessVendors(member: Phase3BAccessFields): boolean {
  return isPhase3BOperational(member);
}

/**
 * Vendor attachment bytes leave the private "vendors" bucket only for
 * operational accounts, through the signed-URL route after this check.
 */
export function canDownloadVendorAttachment(member: Phase3BAccessFields): boolean {
  return isPhase3BOperational(member);
}

/* ------------------------------------------------------------------ */
/* Inventory: movements, minimums and reorder requests                 */
/* ------------------------------------------------------------------ */

export type MovementType = "in" | "out" | "adjustment";
export const MOVEMENT_TYPES: MovementType[] = ["in", "out", "adjustment"];

export type InventoryItemFields = {
  quantity_on_hand: number;
  min_quantity: number;
  status: string;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The stock after a movement. 'in' adds, 'out' subtracts and
 * 'adjustment' applies a SIGNED quantity (a count correction can go
 * either way, and its reason is part of the ledger row).
 */
export function applyMovement(onHand: number, type: MovementType, quantity: number): number {
  if (type === "in") return round2(onHand + quantity);
  if (type === "out") return round2(onHand - quantity);
  return round2(onHand + quantity); // adjustment: quantity is signed
}

/**
 * A movement is valid when: 'in' / 'out' carry a strictly positive
 * quantity; an adjustment carries a non-zero signed quantity; and the
 * resulting stock never goes negative (you cannot take out what the
 * shop does not have, and a correction cannot invent a negative shelf).
 */
export function isValidMovement(
  item: InventoryItemFields,
  type: MovementType,
  quantity: number,
): boolean {
  if (!MOVEMENT_TYPES.includes(type)) return false;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity === 0) return false;
  if (type !== "adjustment" && quantity < 0) return false;
  return applyMovement(item.quantity_on_hand, type, quantity) >= 0;
}

/**
 * At or below the minimum — but only when a minimum is actually set:
 * an item with minimum 0 has no reorder policy and never triggers one.
 */
export function isBelowMinimum(item: InventoryItemFields): boolean {
  return item.min_quantity > 0 && item.quantity_on_hand <= item.min_quantity;
}

/**
 * An automatic reorder request is raised exactly when the item is at
 * or below its minimum AND no open request exists for it yet: the
 * system never stacks duplicate open requests for the same shelf gap.
 */
export function needsAutoReorder(
  item: InventoryItemFields,
  hasOpenRequest: boolean,
): boolean {
  return item.status === "active" && isBelowMinimum(item) && !hasOpenRequest;
}

/**
 * Suggested quantity for a reorder: restock to twice the minimum
 * (cover the gap and refill the buffer). It is a DEFAULT the team can
 * edit on the request — never an imposed order amount.
 */
export function suggestedReorderQuantity(item: InventoryItemFields): number {
  if (!isBelowMinimum(item)) return 0;
  return round2(Math.max(2 * item.min_quantity - item.quantity_on_hand, 0));
}

export type ReorderStatus = "pending" | "ordered" | "received" | "cancelled";
export const REORDER_STATUSES: ReorderStatus[] = ["pending", "ordered", "received", "cancelled"];

const REORDER_TRANSITIONS: Record<ReorderStatus, ReorderStatus[]> = {
  pending: ["ordered", "cancelled"],
  ordered: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

/** Reorder lifecycle: pending → ordered → received (or cancelled). */
export function canChangeReorderStatus(from: ReorderStatus, to: ReorderStatus): boolean {
  return (REORDER_TRANSITIONS[from] || []).includes(to);
}

export function isOpenReorder(status: ReorderStatus): boolean {
  return status === "pending" || status === "ordered";
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export type ToolStatus = "available" | "loaned" | "maintenance" | "retired";
export const TOOL_STATUSES: ToolStatus[] = ["available", "loaned", "maintenance", "retired"];

/** Only a tool sitting in the shop can be loaned out. */
export function canLoanTool(tool: { status: ToolStatus }): boolean {
  return tool.status === "available";
}

/** Only a tool that is out can be returned. */
export function canReturnTool(tool: { status: ToolStatus }): boolean {
  return tool.status === "loaned";
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export type AssetStatus = "active" | "inactive" | "retired";
export const ASSET_STATUSES: AssetStatus[] = ["active", "inactive", "retired"];

/**
 * Warranty state at read time: 'active' while the end date is today or
 * later, 'expired' after it, null when no warranty date is recorded.
 * Computed from the stored date — never stored as a flag.
 */
export function warrantyStatus(
  asset: { warranty_end_date: string | null },
  todayLocal: string,
): "active" | "expired" | null {
  if (!asset.warranty_end_date) return null;
  return asset.warranty_end_date < todayLocal ? "expired" : "active";
}

/* ------------------------------------------------------------------ */
/* Refrigerant records (generic structure — NOT an official form)      */
/* ------------------------------------------------------------------ */

/**
 * A refrigerant record must move SOME gas: at least one of added /
 * recovered strictly positive, neither negative. The fields are the
 * generic structure of a use record; the official form's exact fields
 * are still pending Jose's document (see the phase doc).
 */
export function isValidRefrigerantEntry(entry: {
  amount_added: number;
  amount_recovered: number;
}): boolean {
  const added = entry.amount_added;
  const recovered = entry.amount_recovered;
  if (typeof added !== "number" || typeof recovered !== "number") return false;
  if (!Number.isFinite(added) || !Number.isFinite(recovered)) return false;
  if (added < 0 || recovered < 0) return false;
  return added > 0 || recovered > 0;
}

/* ------------------------------------------------------------------ */
/* Vendor jobs & pendings                                              */
/* ------------------------------------------------------------------ */

export type VendorJobKind =
  | "request" | "appointment" | "quote" | "report" | "pending_part" | "pending_service";
export const VENDOR_JOB_KINDS: VendorJobKind[] = [
  "request", "appointment", "quote", "report", "pending_part", "pending_service",
];

export type VendorJobStatus =
  | "open" | "scheduled" | "in_progress" | "completed" | "verified" | "cancelled";
export const VENDOR_JOB_STATUSES: VendorJobStatus[] = [
  "open", "scheduled", "in_progress", "completed", "verified", "cancelled",
];

export const VENDOR_PENDING_KINDS: VendorJobKind[] = ["pending_part", "pending_service"];

export function isVendorJobFinal(status: VendorJobStatus): boolean {
  return status === "completed" || status === "verified" || status === "cancelled";
}

/**
 * A pending part / service is "still pending" while its job is a
 * pending kind and has not reached a final state — exactly the rows
 * the Pending Parts & Vendor Log prints.
 */
export function isPendingVendorJob(job: { kind: VendorJobKind; status: VendorJobStatus }): boolean {
  return VENDOR_PENDING_KINDS.includes(job.kind) && !isVendorJobFinal(job.status);
}

/** A job completes from any working state. */
export function canCompleteVendorJob(
  member: Phase3BAccessFields,
  job: { status: VendorJobStatus },
): boolean {
  return isPhase3BOperational(member)
    && (job.status === "open" || job.status === "scheduled" || job.status === "in_progress");
}

/**
 * Verification is recorded on a COMPLETED job: who checked the
 * finished work and when. A recorded verifier blocks a second one.
 * OPEN DECISION (documented, not invented): the specification does
 * not require the verifier to differ from the person who completed
 * the job, so this rule does not impose a separation of duties.
 */
export function canVerifyVendorJob(
  member: Phase3BAccessFields,
  job: { status: VendorJobStatus; verified_by_member_id: number | null },
): boolean {
  return isPhase3BOperational(member)
    && job.status === "completed"
    && job.verified_by_member_id == null;
}

/**
 * A next action is overdue when its date is in the past (property
 * local calendar) and the job is not in a final state. Computed at
 * read time — never stored, so it can never go stale.
 */
export function isNextActionOverdue(
  job: { status: VendorJobStatus; next_action_date: string | null },
  todayLocal: string,
): boolean {
  if (isVendorJobFinal(job.status)) return false;
  if (!job.next_action_date) return false;
  return job.next_action_date < todayLocal;
}
