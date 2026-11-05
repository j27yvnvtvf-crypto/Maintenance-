/**
 * Pure authorization and domain rules for the property logbook (Phase 2).
 *
 * Like lib/library-rules.ts, this module is intentionally free of imports
 * and side effects so the exact decisions the server makes can be exercised
 * by the verification suite (scripts/verify-logbook.mjs) without a database.
 * The approval primitives intentionally mirror lib/access-rules.ts
 * (isApprovedAccess); the logbook suite asserts both modules agree on every
 * account state so they cannot silently drift apart.
 *
 * Model summary (extends access model v2, it never replaces it):
 * - The logbook is an OPERATIONAL module. An account is operational when
 *   approval_status = 'approved' AND active = true. Pending / rejected /
 *   suspended / revoked accounts get nothing: no list, no detail, no
 *   comments, no attachments, no downloads (403).
 * - Every operational account has the SAME logbook permissions: create,
 *   update, comment, attach, link, close, reopen and verify events.
 *   Administration (is_admin) grants nothing extra here, and `job_title`
 *   and the legacy `role` grant nothing at all.
 * - Nobody — operational or administrator — can delete a logbook event, a
 *   comment, an attachment record or a history row through the app.
 *   Corrections are new records (a new comment, a new history entry), never
 *   edits of the past. History is append-only and written only by the
 *   server.
 * - Closing an event REQUIRES a final result. Verification is a separate,
 *   later act recorded with its own author and timestamp.
 */

export type LogbookApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type LogbookAccessFields = {
  approval_status: LogbookApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

export type LogEventType =
  | "leak"
  | "equipment_failure"
  | "emergency_call"
  | "damage"
  | "vendor_visit"
  | "inspection"
  | "repair"
  | "other";

export type LogEventStatus = "open" | "in_progress" | "pending" | "closed";

export type LogPriority = "low" | "medium" | "high" | "emergency";

export type LogLinkRelation =
  | "related"
  | "inspection"
  | "vendor_visit"
  | "report"
  | "repair"
  | "verification"
  | "follow_up";

export type NotificationType = "log_assigned" | "log_comment";

export const LOG_EVENT_TYPES: LogEventType[] = [
  "leak",
  "equipment_failure",
  "emergency_call",
  "damage",
  "vendor_visit",
  "inspection",
  "repair",
  "other",
];

export const LOG_EVENT_STATUSES: LogEventStatus[] = [
  "open",
  "in_progress",
  "pending",
  "closed",
];

export const LOG_PRIORITIES: LogPriority[] = ["low", "medium", "high", "emergency"];

export const LOG_LINK_RELATIONS: LogLinkRelation[] = [
  "related",
  "inspection",
  "vendor_visit",
  "report",
  "repair",
  "verification",
  "follow_up",
];

/** Mirror of isApprovedAccess in lib/access-rules.ts. Keep in sync. */
export function isLogbookOperational(member: LogbookAccessFields): boolean {
  return member.active === true && member.approval_status === "approved";
}

/**
 * The single gate for the whole module: list, detail, case chain, comments,
 * history and attachment metadata are all behind this one decision.
 */
export function canAccessLogbook(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/** Any operational account may register a new event. */
export function canCreateEvent(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/**
 * Any operational account may update any event (fields, status, assignee,
 * priority, follow-up). There are no per-author or per-role restrictions:
 * the trail lives in the append-only history, not in lockouts.
 */
export function canUpdateEvent(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/** Any operational account may comment on any event. */
export function canComment(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/** Any operational account may attach evidence files to any event. */
export function canAttach(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/**
 * Attachment bytes leave the private "logbook" bucket only for operational
 * accounts, and only through the signed-URL route after this same check.
 */
export function canDownloadAttachment(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/** Any operational account may link two events into the same case chain. */
export function canLinkEvents(member: LogbookAccessFields): boolean {
  return isLogbookOperational(member);
}

/**
 * Closing is not deleting: the record, its evidence and its history are
 * kept. A close is only valid WITH a final result — without one, the event
 * stays open. This is a domain rule, not a permission tier.
 */
export function canCloseEvent(
  member: LogbookAccessFields,
  event: { status: LogEventStatus },
  finalResult: string | null | undefined,
): boolean {
  if (!isLogbookOperational(member)) return false;
  if (event.status === "closed") return false;
  return typeof finalResult === "string" && finalResult.trim().length > 0;
}

/** A closed event may be reopened by any operational account. */
export function canReopenEvent(
  member: LogbookAccessFields,
  event: { status: LogEventStatus },
): boolean {
  return isLogbookOperational(member) && event.status === "closed";
}

/**
 * Verification is recorded on a CLOSED event: who verified and when. OPEN
 * DECISION (documented, not invented): the specification does not require
 * the verifier to differ from the person who closed the event, so this rule
 * does not impose a separation of duties. If Jose later requires one, this
 * is the single place to add it.
 */
export function canVerifyEvent(
  member: LogbookAccessFields,
  event: { status: LogEventStatus; verified_by_member_id: number | null },
): boolean {
  return (
    isLogbookOperational(member) &&
    event.status === "closed" &&
    event.verified_by_member_id == null
  );
}

/**
 * A follow-up is overdue when it has a follow-up date in the past (property
 * local calendar) and the event is not closed. Computed at read time —
 * overdue state is never stored, so it can never go stale.
 * Dates are YYYY-MM-DD strings and compare correctly as text.
 */
export function isFollowUpOverdue(
  event: { status: LogEventStatus; follow_up_date: string | null },
  todayLocal: string,
): boolean {
  if (event.status === "closed") return false;
  if (!event.follow_up_date) return false;
  return event.follow_up_date < todayLocal;
}

/**
 * Who receives a stored notification when an event is assigned to
 * `assigneeId`: the assignee, unless the assignee is the actor (nobody is
 * notified about their own action — no unnecessary notices).
 */
export function assignmentNotificationRecipients(
  actorMemberId: number,
  assigneeMemberId: number | null,
): number[] {
  if (assigneeMemberId == null) return [];
  if (assigneeMemberId === actorMemberId) return [];
  return [assigneeMemberId];
}

/**
 * Who receives a stored notification when a comment is added: the event's
 * reporter and its responsible member, deduplicated, excluding the comment
 * author. People with no relationship to the event are not notified.
 */
export function commentNotificationRecipients(
  actorMemberId: number,
  event: { reported_by_member_id: number | null; responsible_member_id: number | null },
): number[] {
  const recipients = new Set<number>();
  for (const id of [event.reported_by_member_id, event.responsible_member_id]) {
    if (id != null && id !== actorMemberId) recipients.add(id);
  }
  return [...recipients];
}
