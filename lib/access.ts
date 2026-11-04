import type { User } from "@supabase/supabase-js";
import { createAdminClient, createUserClient } from "@/lib/supabase/server";
import {
  isAdminAccess, isApprovedAccess, normalizePhone,
  type ApprovalStatus,
} from "@/lib/access-rules";

export type { ApprovalStatus } from "@/lib/access-rules";
export { isAdminAccess, isApprovedAccess } from "@/lib/access-rules";

/** Legacy role values, kept only so historical rows remain readable. */
export type Role = "manager" | "service_supervisor" | "technician";

export type MemberRow = {
  id: number;
  user_id: string | null;
  email: string;
  name: string;
  /** Free-text "Posición / Job Title". Informational only — never a permission. */
  job_title: string | null;
  /**
   * Personal phone provided at registration so the administrator can verify
   * the requester's identity. Personal data: it may only leave the server in
   * memberForClientWithPhone (owner's own payload / administrator context).
   */
  phone: string | null;
  /** The ONLY source of administrative privilege. Set solely via docs/admin-bootstrap.sql or by an existing admin. */
  is_admin: boolean;
  /** @deprecated Legacy column. No longer read for authorization. */
  role: Role;
  /** @deprecated Legacy column. No longer read for authorization. */
  requested_role: Role | null;
  approval_status: ApprovalStatus;
  language: "en" | "es";
  active: boolean;
  created_at: string;
};

async function requireUser(): Promise<User> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHENTICATED");
  return data.user;
}

/**
 * Resolves the member row for the authenticated user, creating it on first
 * sign-in. Access model v2 rules enforced here:
 *
 * - Every NEW account is created as approval_status = 'pending',
 *   active = false, is_admin = false. Nobody is auto-approved and nobody is
 *   auto-admin — there is no email allow-list in the runtime anymore.
 * - A row pre-created by the administrator (by email, still unlinked) is
 *   linked to the auth user on first sign-in WITHOUT changing its approval
 *   state: it stays pending until the administrator approves it.
 *   (The old supervisor email allow-list env var is no longer read anywhere.)
 * - The member's state is read from the database on EVERY call, and every
 *   API route calls this per request, so a suspension or revocation takes
 *   effect on the very next request even with an open session.
 */
export async function getCurrentMember(): Promise<MemberRow> {
  const user = await requireUser();
  const admin = createAdminClient();
  const email = (user.email || "").toLowerCase();
  const name = String(user.user_metadata?.full_name || user.user_metadata?.name || email.split("@")[0] || "Team member");
  const jobTitle = String(user.user_metadata?.job_title || "").trim().slice(0, 120) || null;
  // Same metadata path as name and job title: the sign-up form collects the
  // personal phone, it lands in user_metadata, and it is stored (normalized,
  // only when valid) next to the pending access request.
  const phone = normalizePhone(user.user_metadata?.phone);

  let { data: member } = await admin.from("members").select("*").eq("user_id", user.id).maybeSingle<MemberRow>();
  if (!member && email) {
    const existing = await admin.from("members").select("*").eq("email", email).maybeSingle<MemberRow>();
    member = existing.data;
    if (member) {
      // Link the row the administrator pre-registered. Its approval state is
      // NOT changed; if it has no phone yet and the sign-up provided a valid
      // one, the verification phone is filled in with the request.
      const linkUpdate: Record<string, unknown> = { user_id: user.id };
      if (!member.phone && phone) linkUpdate.phone = phone;
      const linked = await admin.from("members").update(linkUpdate).eq("id", member.id).select("*").single<MemberRow>();
      if (linked.error) throw linked.error;
      member = linked.data;
    }
  }

  if (!member) {
    const created = await admin.from("members").insert({
      user_id: user.id,
      email,
      name,
      job_title: jobTitle,
      phone,
      role: "technician",
      requested_role: null,
      approval_status: "pending",
      active: false,
      is_admin: false,
      language: "en",
    }).select("*").single<MemberRow>();
    if (created.error) throw created.error;
    member = created.data;
  }

  return member;
}

/**
 * Default member payload. It deliberately EXCLUDES the personal phone:
 * this builder feeds team lists and every other payload that approved
 * (non-administrator) accounts receive, and the phone is verification
 * data for the administrator only.
 */
export function memberForClient(member: MemberRow) {
  return {
    id: member.id,
    userId: member.user_id,
    email: member.email,
    name: member.name,
    jobTitle: member.job_title,
    isAdmin: member.is_admin,
    approvalStatus: member.approval_status,
    language: member.language,
    active: member.active,
    createdAt: member.created_at,
  };
}

/**
 * Member payload WITH the personal phone. Use ONLY where the viewer is
 * entitled to it:
 * - the account owner's own `me` object (people can see and correct their
 *   own request data), and
 * - administrator-only payloads (the access-request / pending list).
 * Never use it for team lists, assignments or anything a non-administrator
 * can read — see scripts/verify-access-model.mjs, check 8.
 */
export function memberForClientWithPhone(member: MemberRow) {
  return { ...memberForClient(member), phone: member.phone };
}

/** Approved operational access — identical for every approved account. */
export function isApproved(member: MemberRow) {
  return isApprovedAccess(member);
}

/** Administrative access — only the verified administrator account. */
export function isAdmin(member: MemberRow) {
  return isAdminAccess(member);
}
