/**
 * Pure authorization and domain rules for Inspections & PM (Phase 3A).
 *
 * Like lib/logbook-rules.ts and lib/library-rules.ts, this module is
 * intentionally free of imports and side effects so the exact decisions
 * the server makes can be exercised by the verification suite
 * (scripts/verify-inspections.mjs) without a database. The approval and
 * admin primitives intentionally mirror lib/access-rules.ts; the suite
 * asserts the modules agree on every account state.
 *
 * Model summary (extends access model v2, never replaces it):
 * - The module is OPERATIONAL for every approved account with identical
 *   permissions: create and execute inspections, record results and
 *   photos, generate and follow up corrective actions, complete and
 *   verify. Pending / rejected / suspended / revoked accounts get
 *   nothing (403).
 * - TEMPLATES ARE SYSTEM CONFIGURATION. Only the administrator
 *   (is_admin) may create, edit, publish or archive them — the same
 *   line Phase 1 drew for official documents. `job_title` and the
 *   legacy `role` grant nothing anywhere in this module.
 * - Inspection is not repair (Jose's criterion): a result states the
 *   FINDING state — no issue, pending, in progress, waiting on a vendor
 *   or an approval, completed, or N/A. Items that do not apply are
 *   answered N/A, never forced; the system never assumes equipment the
 *   property does not have.
 * - A result in a FINDING state (pending / in progress / waiting) can
 *   generate a corrective action linked to it. Completion of the action
 *   and verification of its closure are separate acts, each recorded
 *   with its own author and timestamp.
 * - Frequencies are CONFIGURABLE DATA the administrator sets per
 *   template (daily / weekly / monthly / quarterly / annual / custom /
 *   none, plus a free-text note). The system presets none of them and
 *   never labels any of them official: applicable frequencies come
 *   from the SOPs and manufacturer instructions, which only the
 *   administrator can speak for.
 * - The daily shop closing record is an inspection executed from a
 *   template of type 'shop_closing': at most one record per day, and
 *   its signature is the typed name plus the server-recorded
 *   completion timestamp.
 */

export type InspApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type InspAccessFields = {
  approval_status: InspApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

export type TemplateType = "inspection" | "shop_closing";

export type TemplateStatus = "draft" | "published" | "archived";

export type FrequencyType =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "custom"
  | "none";

export type ItemResponseType = "status" | "yes_no";

export type ItemResultStatus =
  | "no_issue"
  | "pending"
  | "in_progress"
  | "waiting_vendor"
  | "completed"
  | "na";

export type ItemAnswer = "yes" | "no";

export type InspectionStatus = "scheduled" | "in_progress" | "completed";

export type CorrectiveStatus = "open" | "in_progress" | "completed" | "verified";

export const TEMPLATE_TYPES: TemplateType[] = ["inspection", "shop_closing"];

export const TEMPLATE_STATUSES: TemplateStatus[] = ["draft", "published", "archived"];

/**
 * Configurable frequencies. These are neutral recurrence labels the
 * administrator picks per template — none of them is presented anywhere
 * as the official frequency of any SOP or manufacturer instruction.
 */
export const FREQUENCY_TYPES: FrequencyType[] = [
  "daily", "weekly", "monthly", "quarterly", "annual", "custom", "none",
];

export const ITEM_RESPONSE_TYPES: ItemResponseType[] = ["status", "yes_no"];

export const ITEM_RESULT_STATUSES: ItemResultStatus[] = [
  "no_issue", "pending", "in_progress", "waiting_vendor", "completed", "na",
];

export const INSPECTION_STATUSES: InspectionStatus[] = [
  "scheduled", "in_progress", "completed",
];

export const CORRECTIVE_STATUSES: CorrectiveStatus[] = [
  "open", "in_progress", "completed", "verified",
];

/** Mirror of isApprovedAccess in lib/access-rules.ts. Keep in sync. */
export function isInspectionOperational(member: InspAccessFields | null | undefined): boolean {
  return !!member && member.active === true && member.approval_status === "approved";
}

/** Mirror of isAdminAccess in lib/access-rules.ts. Keep in sync. */
export function isInspectionAdmin(member: InspAccessFields | null | undefined): boolean {
  return !!member && isInspectionOperational(member) && member.is_admin === true;
}

/** The single gate for the whole module (lists, details, downloads). */
export function canAccessInspections(member: InspAccessFields): boolean {
  return isInspectionOperational(member);
}

/**
 * Template management is administration: changing the checklists
 * changes how the system works, so only the verified administrator
 * may create, edit, publish or archive them — never any other account,
 * whatever its job title says.
 */
export function canManageTemplates(member: InspAccessFields): boolean {
  return isInspectionAdmin(member);
}

/** Which templates an account may see: published ones for every
 * operational account; drafts and archived ones only for the admin. */
export function canViewTemplate(
  member: InspAccessFields,
  template: { status: TemplateStatus },
): boolean {
  if (!isInspectionOperational(member)) return false;
  if (template.status === "published") return true;
  return isInspectionAdmin(member);
}

/** Starting an inspection requires a PUBLISHED template (or a free
 * inspection with hand-written items, decided by the API caller). */
export function canStartFromTemplate(
  member: InspAccessFields,
  template: { status: TemplateStatus },
): boolean {
  return isInspectionOperational(member) && template.status === "published";
}

/** Any operational account may create and execute inspections. */
export function canExecuteInspection(member: InspAccessFields): boolean {
  return isInspectionOperational(member);
}

/** Results may be recorded or corrected only while the inspection is
 * not completed: a completed inspection's results are locked evidence.
 * Reopening (a recorded act) is the only way to change them again. */
export function canRecordResult(
  member: InspAccessFields,
  inspection: { status: InspectionStatus },
): boolean {
  return isInspectionOperational(member) && inspection.status !== "completed";
}

/** Any operational account may attach evidence photos or files. */
export function canAttachInspectionFile(member: InspAccessFields): boolean {
  return isInspectionOperational(member);
}

/** Attachment bytes leave the private "inspections" bucket only for
 * operational accounts, via the signed-URL route after this check. */
export function canDownloadInspectionAttachment(member: InspAccessFields): boolean {
  return isInspectionOperational(member);
}

/**
 * A result is a FINDING when work remains: pending, in progress, or
 * waiting on a vendor / an approval. 'no_issue', 'completed' and 'na'
 * are not findings, and neither is an unanswered item.
 */
export function isFindingResult(result: { status: ItemResultStatus | null }): boolean {
  return (
    result.status === "pending" ||
    result.status === "in_progress" ||
    result.status === "waiting_vendor"
  );
}

/**
 * A corrective action is generated FROM a finding. The link to the
 * exact result is what makes the follow-up auditable:
 * finding → action → completion → verification. It may be generated
 * even after the inspection itself was completed — the action is a
 * separate record with its own lifecycle, so a finding never loses
 * its follow-up just because the checklist was closed first.
 */
export function canCreateCorrectiveAction(
  member: InspAccessFields,
  result: { status: ItemResultStatus | null },
): boolean {
  return isInspectionOperational(member) && isFindingResult(result);
}

/** Follow-up work on an action that is neither completed nor verified. */
export function canUpdateCorrectiveAction(
  member: InspAccessFields,
  action: { status: CorrectiveStatus },
): boolean {
  return (
    isInspectionOperational(member) &&
    action.status !== "completed" &&
    action.status !== "verified"
  );
}

/** Completing an action states the work is done; verification of the
 * closure is a separate, later act (see canVerifyCorrectiveAction). */
export function canCompleteCorrectiveAction(
  member: InspAccessFields,
  action: { status: CorrectiveStatus },
): boolean {
  return (
    isInspectionOperational(member) &&
    (action.status === "open" || action.status === "in_progress")
  );
}

/**
 * Verification is recorded on a COMPLETED action: who verified the
 * closure and when. OPEN DECISION (documented, not invented): the
 * specification does not require the verifier to differ from whoever
 * completed the action, so this rule imposes no separation of duties.
 * If Jose later requires one, this is the single place to add it.
 */
export function canVerifyCorrectiveAction(
  member: InspAccessFields,
  action: { status: CorrectiveStatus; verified_by_member_id: number | null },
): boolean {
  return (
    isInspectionOperational(member) &&
    action.status === "completed" &&
    action.verified_by_member_id == null
  );
}

/**
 * An inspection can be completed when every REQUIRED item has an
 * answer (a status or N/A). Optional items may be left unanswered;
 * they are simply not evidence either way. Unanswered required items
 * block completion — the checklist cannot be closed half-answered.
 */
export function canCompleteInspection(
  member: InspAccessFields,
  inspection: { status: InspectionStatus },
  results: { required: boolean; status: ItemResultStatus | null; answer?: ItemAnswer | null }[],
): boolean {
  if (!isInspectionOperational(member)) return false;
  if (inspection.status === "completed") return false;
  return results.every(
    (result) => !result.required || result.status != null || result.answer != null,
  );
}

/** A completed inspection may be reopened by any operational account;
 * the reopening is written to the history like every other act. */
export function canReopenInspection(
  member: InspAccessFields,
  inspection: { status: InspectionStatus },
): boolean {
  return isInspectionOperational(member) && inspection.status === "completed";
}

/**
 * An inspection is overdue when its scheduled date is in the past
 * (property local calendar) and it is not completed. Computed at read
 * time — overdue state is never stored, so it can never go stale.
 * Dates are YYYY-MM-DD strings and compare correctly as text.
 */
export function isInspectionOverdue(
  inspection: { status: InspectionStatus; scheduled_date: string | null },
  todayLocal: string,
): boolean {
  if (inspection.status === "completed") return false;
  if (!inspection.scheduled_date) return false;
  return inspection.scheduled_date < todayLocal;
}

/** A corrective action is overdue when its due date has passed and the
 * action is neither completed nor verified. Computed at read time. */
export function isCorrectiveOverdue(
  action: { status: CorrectiveStatus; due_date: string | null },
  todayLocal: string,
): boolean {
  if (action.status === "completed" || action.status === "verified") return false;
  if (!action.due_date) return false;
  return action.due_date < todayLocal;
}
