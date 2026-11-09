/**
 * Pure domain rules for the central work registry (Phase 5 — Centro de
 * Operaciones): work orders AND property tasks share one record shape.
 *
 * Like lib/logbook-rules.ts and lib/inspections-rules.ts, this module is
 * intentionally free of imports and side effects so the exact decisions
 * the server makes can be exercised by the verification suite
 * (scripts/verify-centro.mjs) without a database. Access control is NOT
 * redefined here: access model v2 (lib/access-rules.ts) still gates
 * every request; this module only decides what a valid job, a valid
 * hold and a valid closing look like.
 *
 * Model summary:
 * - 'assigned' is no longer a state (the assignment lives in
 *   assigned_to; the visible state is Abierto). It survives in
 *   JOB_STATUSES only as a legacy read value the migration converts to
 *   'open'; no transition may move INTO it.
 * - Holds are differentiated: waiting_vendor / waiting_parts /
 *   waiting_resident, plus the legacy 'on_hold'. ANY hold status
 *   requires the same four recorded facts: hold_reason,
 *   hold_follow_up_date, hold_follow_up_by and next_action
 *   (validateHold). The API enforces this on the server (400), not
 *   only in the form.
 * - Completing a job requires verification: the work performed
 *   (action_performed, or verification_action when it supersedes it)
 *   plus verification_test, verification_result and an explicit
 *   verification_confirmed = true (validateClose). verified_* are
 *   written by the server at that moment; reopening clears them and a
 *   new closing demands a new verification.
 * - GOLDEN RULE: nothing automatic completes a job — not a date, not
 *   a part arriving, not a vendor visit, not a note's wording. Only a
 *   recorded closing that passes validateClose does.
 * - Overdue and priority are computed at read time (priorityScore /
 *   sortJobsForToday); nothing is stored, so nothing goes stale.
 */

export type JobStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "waiting_vendor"
  | "waiting_parts"
  | "waiting_resident"
  | "on_hold"
  | "completed";

export type HoldStatus = "waiting_vendor" | "waiting_parts" | "waiting_resident" | "on_hold";

export type JobPriority = "low" | "medium" | "high" | "emergency";

export type JobRecordType = "work_order" | "task";

export type JobOrigin =
  | "daily_operation"
  | "resident"
  | "rmm_audit"
  | "client_requirement"
  | "move_out"
  | "preventive";

/** Client shape of a job: mirrors jobForClient in
 * app/api/dashboard/route.ts, extended with the Phase 5 fields. */
export type Job = {
  id: number;
  title: string;
  description: string;
  area: string | null;
  category: string | null;
  priority: JobPriority | string;
  status: JobStatus | string;
  assignedTo: number | null;
  assignedName?: string | null;
  dueDate: string | null;
  completionComment: string | null;
  residentNote: string | null;
  createdAt: string;
  updatedAt: string;
  recordType: JobRecordType | string;
  origin: JobOrigin | string;
  externalRef: string | null;
  building: string | null;
  unit: string | null;
  scheduledDate: string | null;
  findings: string | null;
  cause: string | null;
  actionPerformed: string | null;
  nextAction: string | null;
  holdReason: string | null;
  holdFollowUpDate: string | null;
  holdFollowUpBy: number | null;
  holdFollowUpByName?: string | null;
  vendorId: number | null;
  vendorName?: string | null;
  verificationAction: string | null;
  verificationTest: string | null;
  verificationResult: string | null;
  verificationConfirmed: boolean;
  verifiedByMemberId: number | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  maintenanceCommentDraft: string | null;
  residentNoteDraft: string | null;
  notesFingerprint: string | null;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  version: number;
  collaboratorIds?: number[];
};

export type JobFilters = {
  building?: string | null;
  unit?: string | null;
  category?: string | null;
  assignedTo?: number | null;
  priority?: string | null;
  status?: string | string[] | null;
  origin?: string | null;
  vendorId?: number | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
};

export const JOB_STATUSES: JobStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "waiting_vendor",
  "waiting_parts",
  "waiting_resident",
  "on_hold",
  "completed",
];

export const JOB_STATUS_LABELS_ES: Record<JobStatus, string> = {
  open: "Abierto",
  assigned: "Asignado (legado)",
  in_progress: "En proceso",
  waiting_vendor: "Esperando proveedor",
  waiting_parts: "Esperando piezas",
  waiting_resident: "Esperando al residente",
  on_hold: "En espera",
  completed: "Completado",
};

export const HOLD_STATUSES: HoldStatus[] = [
  "waiting_vendor",
  "waiting_parts",
  "waiting_resident",
  "on_hold",
];

export const JOB_PRIORITIES: JobPriority[] = ["low", "medium", "high", "emergency"];

export const JOB_PRIORITY_LABELS_ES: Record<JobPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  emergency: "Urgente",
};

export const JOB_RECORD_TYPES: JobRecordType[] = ["work_order", "task"];

/** Stable category keys with their Spanish labels (spec §4). The keys
 * are what gets stored; the labels are display only. */
export const JOB_CATEGORIES: { key: string; es: string; en: string }[] = [
  { key: "hvac", es: "HVAC", en: "HVAC" },
  { key: "plumbing", es: "Plomería", en: "Plumbing" },
  { key: "electrical", es: "Electricidad", en: "Electrical" },
  { key: "appliances", es: "Electrodomésticos", en: "Appliances" },
  { key: "doors_locks", es: "Puertas y cerraduras", en: "Doors & locks" },
  { key: "security", es: "Seguridad", en: "Security / life safety" },
  { key: "painting_drywall", es: "Pintura / drywall", en: "Painting / drywall" },
  { key: "cleaning", es: "Limpieza", en: "Cleaning / turns" },
  { key: "pool_common_areas", es: "Piscina y áreas comunes", en: "Pool & common areas" },
  { key: "general", es: "General", en: "General" },
];

export const JOB_CATEGORY_KEYS: string[] = JOB_CATEGORIES.map((category) => category.key);

/** Structured locations of The Darley: the seven residential
 * buildings plus the shared areas. */
export const JOB_BUILDINGS: string[] = [
  "1000",
  "2000",
  "3000",
  "4000",
  "5000",
  "6000",
  "7000",
  "Clubhouse",
  "Pool",
  "Grills",
  "Shop",
  "Office",
  "Grounds",
  "Other",
];

export const JOB_ORIGINS: JobOrigin[] = [
  "daily_operation",
  "resident",
  "rmm_audit",
  "client_requirement",
  "move_out",
  "preventive",
];

export const JOB_ORIGIN_LABELS_ES: Record<JobOrigin, string> = {
  daily_operation: "Operación diaria",
  resident: "Residente",
  rmm_audit: "Auditoría RMM",
  client_requirement: "Requerimiento del cliente",
  move_out: "Salida / make-ready",
  preventive: "Preventivo",
};

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when the status is any kind of hold (espera), legacy included. */
export function isHoldStatus(status: string | null | undefined): status is HoldStatus {
  return typeof status === "string" && (HOLD_STATUSES as string[]).includes(status);
}

/**
 * A hold is valid only with the four recorded facts: WHY it waits
 * (hold_reason), WHEN it will be followed up (hold_follow_up_date),
 * WHO follows it up (hold_follow_up_by) and WHAT happens next
 * (next_action). Returns the list of Spanish error messages (empty =
 * valid). For a job that is not in a hold status there is nothing to
 * validate and the list is empty.
 */
export function validateHold(job: {
  status: string;
  holdReason?: string | null;
  holdFollowUpDate?: string | null;
  holdFollowUpBy?: number | null;
  nextAction?: string | null;
}): string[] {
  if (!isHoldStatus(job.status)) return [];
  const errors: string[] = [];
  if (!nonEmpty(job.holdReason)) {
    errors.push("Falta el motivo de la espera: explica por qué el trabajo está detenido.");
  }
  if (!nonEmpty(job.holdFollowUpDate)) {
    errors.push("Falta la fecha de seguimiento de la espera.");
  }
  if (job.holdFollowUpBy == null) {
    errors.push("Falta el responsable del seguimiento de la espera.");
  }
  if (!nonEmpty(job.nextAction)) {
    errors.push("Falta la próxima acción: qué sigue cuando se levante la espera.");
  }
  return errors;
}

/** Alias kept for the Phase 5 contract wording. */
export const holdErrors = validateHold;

/**
 * A closing is valid only with recorded verification: the work
 * performed (action_performed, or verification_action when the
 * verifier records a different final action), the TEST that was run
 * (verification_test), its RESULT (verification_result) and the
 * explicit confirmation flag (verification_confirmed === true).
 * Returns the list of Spanish error messages (empty = valid). This is
 * the server-side gate: update_job answers 400 with these errors
 * instead of closing the job.
 */
export function validateClose(job: {
  actionPerformed?: string | null;
  verificationAction?: string | null;
  verificationTest?: string | null;
  verificationResult?: string | null;
  verificationConfirmed?: boolean | null;
}): string[] {
  const errors: string[] = [];
  if (!nonEmpty(job.actionPerformed) && !nonEmpty(job.verificationAction)) {
    errors.push("Falta registrar el trabajo realizado (o la acción verificada) para cerrar.");
  }
  if (!nonEmpty(job.verificationTest)) {
    errors.push("Falta la prueba de verificación: qué se probó antes de cerrar.");
  }
  if (!nonEmpty(job.verificationResult)) {
    errors.push("Falta el resultado de la verificación.");
  }
  if (job.verificationConfirmed !== true) {
    errors.push("Falta confirmar la verificación: el cierre debe confirmarse explícitamente.");
  }
  return errors;
}

/** Alias kept for the Phase 5 contract wording. */
export const closeErrors = validateClose;

/**
 * Status transitions. Deliberately permissive — the API, not this
 * function, decides whether a closing carries its verification
 * (validateClose) or a hold carries its four facts (validateHold).
 * Forbidden here:
 * - same-status no-ops;
 * - any transition INTO the legacy 'assigned' state;
 * - any transition out of 'completed' into a hold status;
 * - a completed job going anywhere except reopening (to 'open' or
 *   'in_progress'); in particular it can never move directly into
 *   another completed state or be re-closed silently.
 */
export function canTransition(from: string, to: string): boolean {
  if (!(JOB_STATUSES as string[]).includes(from)) return false;
  if (!(JOB_STATUSES as string[]).includes(to)) return false;
  if (from === to) return false;
  if (to === "assigned") return false;
  if (from === "completed") {
    return to === "open" || to === "in_progress";
  }
  return true;
}

/** Whole days between two YYYY-MM-DD dates (b - a); NaN-safe → 0. */
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const PRIORITY_BASE: Record<string, number> = {
  emergency: 100,
  high: 60,
  medium: 30,
  low: 10,
};

/**
 * Suggested order for "what to do first": a pure score computed at
 * read time from the recorded facts and today's date (YYYY-MM-DD,
 * property local calendar).
 * - Priority base: emergency 100 > high 60 > medium 30 > low 10.
 * - Overdue work (due date — or scheduled date when there is no due
 *   date — in the past) gains 5 per overdue day.
 * - Work due TODAY gains 25.
 * - A blocked job (hold status) whose follow-up date is today or past
 *   gains 40, plus 3 per overdue follow-up day: a hold nobody is
 *   chasing is the most dangerous kind of pending work.
 * - Completed jobs score below everything (-1000): they never lead
 *   the day list.
 */
export function priorityScore(
  job: {
    status: string;
    priority: string;
    dueDate?: string | null;
    scheduledDate?: string | null;
    holdFollowUpDate?: string | null;
  },
  todayISO: string,
): number {
  if (job.status === "completed") return -1000;
  let score = PRIORITY_BASE[job.priority] ?? PRIORITY_BASE.medium;
  const effectiveDate = job.dueDate || job.scheduledDate || null;
  if (effectiveDate) {
    const overdueDays = daysBetween(effectiveDate, todayISO);
    if (overdueDays > 0) score += overdueDays * 5;
    else if (overdueDays === 0) score += 25;
  }
  if (isHoldStatus(job.status) && job.holdFollowUpDate) {
    const followUpOverdueDays = daysBetween(job.holdFollowUpDate, todayISO);
    if (followUpOverdueDays >= 0) score += 40 + followUpOverdueDays * 3;
  }
  return score;
}

/**
 * The day list: highest priorityScore first; ties break by earlier
 * effective date (due, else scheduled), then by creation order (id).
 * Returns a new array; the input is not mutated.
 */
export function sortJobsForToday<T extends Parameters<typeof priorityScore>[0] & { id: number }>(
  jobs: T[],
  todayISO: string,
): T[] {
  const effective = (job: T) => job.dueDate || job.scheduledDate || "9999-12-31";
  return [...jobs].sort((a, b) => {
    const byScore = priorityScore(b, todayISO) - priorityScore(a, todayISO);
    if (byScore !== 0) return byScore;
    const byDate = effective(a).localeCompare(effective(b));
    if (byDate !== 0) return byDate;
    return a.id - b.id;
  });
}

function matchesText(value: string | null | undefined, filter: string): boolean {
  return (value || "").trim().toLowerCase() === filter.trim().toLowerCase();
}

/**
 * Combinable list filters (spec §12). Every present filter must match
 * (AND); absent/empty filters match everything. `from`/`to` bound the
 * job's effective date (scheduled, else due, else the creation date).
 * `q` searches title, description, external reference, building, unit
 * and the numeric id, case-insensitively.
 */
export function jobMatchesFilters(
  job: {
    id?: number | null;
    title: string;
    description?: string | null;
    externalRef?: string | null;
    building?: string | null;
    unit?: string | null;
    category?: string | null;
    assignedTo?: number | null;
    priority?: string | null;
    status: string;
    origin?: string | null;
    vendorId?: number | null;
    scheduledDate?: string | null;
    dueDate?: string | null;
    createdAt?: string | null;
  },
  filters: JobFilters,
): boolean {
  if (filters.building && !matchesText(job.building, filters.building)) return false;
  if (filters.unit && !matchesText(job.unit, filters.unit)) return false;
  if (filters.category && !matchesText(job.category, filters.category)) return false;
  if (filters.priority && job.priority !== filters.priority) return false;
  if (filters.origin && job.origin !== filters.origin) return false;
  if (filters.assignedTo != null && job.assignedTo !== filters.assignedTo) return false;
  if (filters.vendorId != null && job.vendorId !== filters.vendorId) return false;
  if (filters.status != null && filters.status !== "") {
    const wanted = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (wanted.length > 0 && !wanted.includes(job.status)) return false;
  }
  const effectiveDate =
    job.scheduledDate || job.dueDate || (job.createdAt ? job.createdAt.slice(0, 10) : null);
  if (filters.from && (!effectiveDate || effectiveDate < filters.from)) return false;
  if (filters.to && (!effectiveDate || effectiveDate > filters.to)) return false;
  if (filters.q && filters.q.trim().length > 0) {
    const needle = filters.q.trim().toLowerCase();
    const haystack = [
      job.title,
      job.description || "",
      job.externalRef || "",
      job.building || "",
      job.unit || "",
      String(job.id ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
