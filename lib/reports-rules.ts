/**
 * Pure rules for reports and audit dossiers (Phase 4).
 *
 * Like the other phase rule modules, this file is intentionally free of
 * imports and side effects so the exact decisions the server makes can be
 * exercised by the verification suite (scripts/verify-reports.mjs) without
 * a database. The approval primitives intentionally mirror
 * lib/access-rules.ts; the reports suite asserts both modules agree on
 * every account state so they cannot silently drift apart.
 *
 * Model summary (extends access model v2, it never replaces it):
 * - Reports are an OPERATIONAL module. Searching, building dossiers and
 *   exporting CSV are available to every approved account in equality:
 *   an account is operational when approval_status = 'approved' AND
 *   active = true. Pending / rejected / suspended / revoked accounts get
 *   nothing — no search results, no dossier, no CSV (403).
 * - The administrative history (admin_audit_log) is NOT operational data:
 *   only the verified administrator may consult it, and only through the
 *   admin-gated view. The admin flag grants nothing extra in the
 *   operational search itself, and `job_title` grants nothing at all.
 * - EVIDENCE HONESTY (explicit requirement from Jose): a record that HAS
 *   an attachment has "evidence available"; that is NOT a verification.
 *   A record is "verified" only when a verification act is recorded with
 *   BOTH a verifier and a timestamp. Attachments never count as
 *   verification, and completion is not verification either.
 */

export type ReportsApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type ReportsAccessFields = {
  approval_status: ReportsApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

/** Mirror of isApprovedAccess in lib/access-rules.ts. Keep in sync. */
export function isReportsOperational(member: ReportsAccessFields): boolean {
  return member.active === true && member.approval_status === "approved";
}

/** Mirror of isAdminAccess in lib/access-rules.ts. Keep in sync. */
export function isReportsAdmin(member: ReportsAccessFields): boolean {
  return isReportsOperational(member) && member.is_admin === true;
}

/** Filtered search across the operational modules. */
export function canAccessReports(member: ReportsAccessFields): boolean {
  return isReportsOperational(member);
}

/** Case / apartment dossiers. Same operational gate as the search. */
export function canBuildDossier(member: ReportsAccessFields): boolean {
  return isReportsOperational(member);
}

/** CSV export. A pending account receives 403 here too — no exceptions. */
export function canExportReports(member: ReportsAccessFields): boolean {
  return isReportsOperational(member);
}

/**
 * The administrative history is administrator-only. An approved
 * non-administrator gets false here even though every operational report
 * is open to them.
 */
export function canViewAdminActivity(member: ReportsAccessFields): boolean {
  return isReportsAdmin(member);
}

// ---------------------------------------------------------------------------
// Modules and filters
// ---------------------------------------------------------------------------

export const REPORT_MODULES = [
  "logbook",
  "inspections",
  "corrective",
  "work_orders",
  "inventory",
  "movements",
  "reorders",
  "tools",
  "assets",
  "refrigerant",
  "vendors",
] as const;

export type ReportModule = (typeof REPORT_MODULES)[number];

export type ReportFilters = {
  module: ReportModule | "all";
  /** Inclusive local-date range (YYYY-MM-DD, property calendar). */
  from: string | null;
  to: string | null;
  memberId: number | null;
  status: string | null;
  building: string | null;
  unit: string | null;
  q: string;
  lowStockOnly: boolean;
};

function validYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return text;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

/**
 * Normalizes raw query parameters into a safe filter set. Invalid values
 * are dropped (never trusted); a reversed date range is swapped so the
 * filter is always satisfiable and deterministic. Unknown modules fall
 * back to "all".
 */
export function normalizeReportFilters(
  raw: Record<string, string | null | undefined>,
): ReportFilters {
  const moduleRaw = (raw.module || "").trim();
  const moduleKey = (REPORT_MODULES as readonly string[]).includes(moduleRaw)
    ? (moduleRaw as ReportModule)
    : "all";
  let from = validYmd(raw.from);
  let to = validYmd(raw.to);
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const memberNumber = Number(raw.memberId || "");
  const memberId =
    Number.isInteger(memberNumber) && memberNumber > 0 ? memberNumber : null;
  const statusRaw = cleanText(raw.status, 40);
  const status = statusRaw && /^[a-z_]+$/.test(statusRaw) ? statusRaw : null;
  return {
    module: moduleKey,
    from,
    to,
    memberId,
    status,
    building: cleanText(raw.building, 60),
    unit: cleanText(raw.unit, 60),
    q: cleanText(raw.q, 120) || "",
    lowStockOnly: raw.lowStock === "1" || raw.lowStock === "true",
  };
}

/** True when a local date (YYYY-MM-DD) falls inside the filter range. */
export function dateInRange(
  localDay: string,
  filters: Pick<ReportFilters, "from" | "to">,
): boolean {
  if (filters.from && localDay < filters.from) return false;
  if (filters.to && localDay > filters.to) return false;
  return true;
}

/** Case-insensitive substring match over a record's searchable fields. */
export function matchesQuery(
  q: string,
  fields: (string | number | null | undefined)[],
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) =>
    String(field ?? "").toLowerCase().includes(needle),
  );
}

// ---------------------------------------------------------------------------
// Evidence honesty
// ---------------------------------------------------------------------------

export type EvidenceState = "verified" | "evidence_unverified" | "no_evidence";

export type EvidenceInput = {
  /** Number of attachments (evidence files) recorded for the record. */
  attachmentCount: number;
  /** Name of the person who performed the verification, if any. */
  verifiedByName: string | null;
  /** Timestamp of the verification act, if any. */
  verifiedAt: string | null;
};

/**
 * THE honesty rule of this module:
 * - "verified" ONLY when a verification act exists with both an author
 *   and a timestamp. Attachments never produce this state, and neither
 *   does a completed status.
 * - "evidence_unverified" when evidence files exist but nobody has
 *   recorded a verification.
 * - "no_evidence" when there is neither.
 */
export function evidenceState(input: EvidenceInput): EvidenceState {
  if (input.verifiedByName && input.verifiedAt) return "verified";
  if (input.attachmentCount > 0) return "evidence_unverified";
  return "no_evidence";
}

export type TimelineEntry = {
  kind:
    | "log_event"
    | "work_order"
    | "inspection"
    | "corrective_action"
    | "vendor_job"
    | "refrigerant"
    | "inventory_movement"
    | "asset";
  id: number;
  ref: string;
  /** ISO timestamp (or YYYY-MM-DD) the entry is ordered by. */
  date: string;
  title: string;
  status: string | null;
  detail: string | null;
  /** null when the record type has no evidence/verification semantics. */
  evidence: EvidenceState | null;
  attachmentCount: number;
  verifiedByName: string | null;
  verifiedAt: string | null;
};

/** Chronological order; ties break deterministically by kind, then id. */
export function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    return a.id - b.id;
  });
}

export type EvidenceSummary = {
  total: number;
  withEvidenceSemantics: number;
  verified: number;
  evidenceUnverified: number;
  noEvidence: number;
};

/** Counts over a dossier/search set — never upgrades evidence to verified. */
export function summarizeEvidence(
  entries: { evidence: EvidenceState | null }[],
): EvidenceSummary {
  const summary: EvidenceSummary = {
    total: entries.length,
    withEvidenceSemantics: 0,
    verified: 0,
    evidenceUnverified: 0,
    noEvidence: 0,
  };
  for (const entry of entries) {
    if (entry.evidence === null) continue;
    summary.withEvidenceSemantics += 1;
    if (entry.evidence === "verified") summary.verified += 1;
    else if (entry.evidence === "evidence_unverified") summary.evidenceUnverified += 1;
    else summary.noEvidence += 1;
  }
  return summary;
}

/** The dossier's "not verified" section: evidence exists, verification does not. */
export function unverifiedEntries<T extends { evidence: EvidenceState | null }>(
  entries: T[],
): T[] {
  return entries.filter((entry) => entry.evidence === "evidence_unverified");
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export type CsvColumn = { key: string; header: string };

const col = (key: string, header: string): CsvColumn => ({ key, header });

/**
 * The declared columns of every exportable module. The server CSV
 * generator emits exactly these columns, in this order — the verify
 * suite asserts the contract so an export can never silently change
 * shape.
 */
export const CSV_COLUMNS: Record<ReportModule, CsvColumn[]> = {
  logbook: [
    col("id", "ID"), col("folio", "Folio"), col("occurredAt", "Occurred at"),
    col("registeredAt", "Registered at"), col("type", "Type"),
    col("status", "Status"), col("priority", "Priority"),
    col("building", "Building"), col("unit", "Unit"), col("area", "Area"),
    col("equipment", "Equipment"), col("description", "Description"),
    col("reportedBy", "Reported by"), col("responsible", "Responsible"),
    col("followUpDate", "Follow-up date"), col("finalResult", "Final result"),
    col("attachments", "Attachments"), col("evidenceState", "Evidence state"),
    col("verifiedBy", "Verified by"), col("verifiedAt", "Verified at"),
    col("officialWoRef", "Official WO ref"),
  ],
  inspections: [
    col("id", "ID"), col("folio", "Folio"), col("createdAt", "Created at"),
    col("title", "Title"), col("template", "Template"), col("status", "Status"),
    col("building", "Building"), col("unit", "Unit"), col("area", "Area"),
    col("equipment", "Equipment"), col("assignedTo", "Assigned to"),
    col("scheduledDate", "Scheduled date"), col("completedBy", "Completed by"),
    col("completedAt", "Completed at"), col("attachments", "Attachments"),
    col("evidenceState", "Evidence state"),
  ],
  corrective: [
    col("id", "ID"), col("createdAt", "Created at"),
    col("inspectionFolio", "Inspection folio"), col("description", "Description"),
    col("status", "Status"), col("responsible", "Responsible"),
    col("dueDate", "Due date"), col("completedBy", "Completed by"),
    col("completedAt", "Completed at"), col("attachments", "Attachments"),
    col("evidenceState", "Evidence state"), col("verifiedBy", "Verified by"),
    col("verifiedAt", "Verified at"),
    col("workOrderId", "Work order ID"), col("logEventFolio", "Log event folio"),
  ],
  work_orders: [
    col("id", "ID"), col("createdAt", "Created at"), col("title", "Title"),
    col("area", "Unit / Area"), col("category", "Category"),
    col("priority", "Priority"), col("status", "Status"),
    col("assignedTo", "Assigned to"), col("dueDate", "Due date"),
    col("completionComment", "Completion comment"),
  ],
  inventory: [
    col("id", "ID"), col("name", "Item"), col("colorCategory", "Color (SOP 5025)"),
    col("quantityOnHand", "On hand"), col("minQuantity", "Minimum"),
    col("belowMinimum", "Below minimum"), col("unit", "Unit"),
    col("supplier", "Supplier"), col("location", "Shop location"),
    col("status", "Status"),
  ],
  movements: [
    col("id", "ID"), col("createdAt", "Date"), col("item", "Item"),
    col("type", "Type"), col("quantity", "Quantity"), col("reason", "Reason"),
    col("actor", "Recorded by"), col("workOrderId", "Work order ID"),
    col("logEventFolio", "Log event folio"),
  ],
  reorders: [
    col("id", "ID"), col("createdAt", "Created at"), col("item", "Item"),
    col("quantityRequested", "Quantity requested"), col("status", "Status"),
    col("source", "Source"), col("responsible", "Responsible"),
    col("orderedBy", "Ordered by"), col("orderedAt", "Ordered at"),
    col("receivedBy", "Received by"), col("receivedAt", "Received at"),
  ],
  tools: [
    col("id", "ID"), col("name", "Tool"), col("serialNumber", "Serial number"),
    col("status", "Status"), col("currentHolder", "Current holder"),
    col("loanedAt", "Loaned at"),
  ],
  assets: [
    col("id", "ID"), col("name", "Asset"), col("type", "Type"),
    col("building", "Building"), col("unit", "Unit"), col("area", "Area"),
    col("brand", "Brand"), col("model", "Model"),
    col("serialNumber", "Serial number"), col("installedDate", "Installed"),
    col("warrantyEndDate", "Warranty ends"), col("status", "Status"),
  ],
  refrigerant: [
    col("id", "ID"), col("logDate", "Date"), col("asset", "Asset"),
    col("equipment", "Equipment"), col("refrigerantType", "Refrigerant"),
    col("amountAdded", "Added"), col("amountRecovered", "Recovered"),
    col("amountUnit", "Unit"), col("technician", "Technician"),
    col("reason", "Reason / work"),
  ],
  vendors: [
    col("id", "ID"), col("createdAt", "Created at"), col("vendor", "Vendor"),
    col("kind", "Kind"), col("title", "Title"), col("status", "Status"),
    col("relatedLocation", "Related location"), col("responsible", "Responsible"),
    col("nextAction", "Next action"), col("nextActionDate", "Next action date"),
    col("attachments", "Attachments"), col("evidenceState", "Evidence state"),
    col("completedBy", "Completed by"), col("completedAt", "Completed at"),
    col("verifiedBy", "Verified by"), col("verifiedAt", "Verified at"),
  ],
};

/**
 * One CSV cell. Spreadsheet formula injection is neutralized (a leading
 * =, +, -, @, tab or CR gets a quote prefix) because audit exports are
 * opened in Excel/Sheets by people outside the app.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Builds a complete CSV document for one module from keyed rows. */
export function buildCsv(
  module: ReportModule,
  rows: Record<string, unknown>[],
): string {
  const columns = CSV_COLUMNS[module];
  const lines = [columns.map((column) => csvEscape(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column.key])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
