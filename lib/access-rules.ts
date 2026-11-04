/**
 * Pure authorization rules for access model v2.
 *
 * This module is intentionally free of imports and side effects so the exact
 * same decisions the server makes can be exercised by the verification
 * suite (scripts/verify-access-model.mjs) without a database.
 *
 * Model summary:
 * - `job_title` is free text typed by the user. It is informational only and
 *   is NOT an input to any function in this file: it cannot grant anything.
 * - Operational access comes only from approval: an account is operational
 *   when approval_status = 'approved' AND active = true. Every approved
 *   account has the SAME operational permissions.
 * - Administrative access comes only from `is_admin = true` on the member
 *   row linked to the authenticated user_id. Nothing else (email lists,
 *   name, job title, legacy role, signup order) grants it.
 */

export type ApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type AccessFields = {
  approval_status: ApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

/** True when the account may use the app's operational features and data. */
export function isApprovedAccess(member: AccessFields): boolean {
  return member.active === true && member.approval_status === "approved";
}

/** True only for the verified administrator account. */
export function isAdminAccess(member: AccessFields): boolean {
  return isApprovedAccess(member) && member.is_admin === true;
}

export type AccessState =
  | "approved"
  | "pending"
  | "rejected"
  | "suspended"
  | "revoked"
  | "unregistered";

/** The single state the UI and API use to describe an account's access. */
export function accessState(member: AccessFields): AccessState {
  if (isApprovedAccess(member)) return "approved";
  return member.approval_status;
}

/**
 * States from which a person may (re)submit an access request with their
 * job title. A suspended or revoked account cannot reactivate itself; only
 * the administrator can approve it again.
 */
export function canRequestAccess(member: AccessFields): boolean {
  return (
    member.approval_status === "unregistered" ||
    member.approval_status === "pending" ||
    member.approval_status === "rejected"
  );
}

/**
 * An administrator acts on OTHER accounts only. Self-approval,
 * self-suspension and self-revocation are structurally impossible: the API
 * rejects any administrative action whose target is the actor.
 */
export function canAdminActOn(
  actor: AccessFields & { id: number },
  target: { id: number },
): boolean {
  return isAdminAccess(actor) && target.id !== actor.id;
}

/**
 * Personal phone — identity-verification data collected at registration so
 * the administrator can confirm that an access requester is a real person
 * they know before approving the account. It is NOT a permission input and
 * it is never exposed outside the administrator context (plus the account
 * owner's own request screen); see memberForClient in lib/access.ts.
 *
 * Basic format validation only: an optional leading "+", digits, spaces,
 * dashes, dots and parentheses, with 7 to 15 digits in total (15 is the
 * E.164 maximum). Anything else is rejected with a clear message.
 */
export function isValidPhone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  if (!/^\+?[0-9\s().-]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** Canonical stored form: digits only, preserving a leading "+". */
export function normalizePhone(value: unknown): string | null {
  if (!isValidPhone(value)) return null;
  const raw = (value as string).trim();
  const digits = raw.replace(/\D/g, "");
  return raw.startsWith("+") ? `+${digits}` : digits;
}
