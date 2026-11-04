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
