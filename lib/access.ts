import type { User } from "@supabase/supabase-js";
import { createAdminClient, createUserClient } from "@/lib/supabase/server";

export type Role = "manager" | "service_supervisor" | "technician";
export type ApprovalStatus = "unregistered" | "pending" | "approved";

export type MemberRow = {
  id: number;
  user_id: string | null;
  email: string;
  name: string;
  role: Role;
  requested_role: Role | null;
  approval_status: ApprovalStatus;
  language: "en" | "es";
  active: boolean;
  created_at: string;
};

function configuredSupervisor(email: string) {
  return (process.env.SUPERVISOR_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

async function requireUser(): Promise<User> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHENTICATED");
  return data.user;
}

export async function getCurrentMember() {
  const user = await requireUser();
  const admin = createAdminClient();
  const email = (user.email || "").toLowerCase();
  const name = String(user.user_metadata?.full_name || user.user_metadata?.name || email.split("@")[0] || "Team member");
  const isOwner = configuredSupervisor(email);

  let { data: member } = await admin.from("members").select("*").eq("user_id", user.id).maybeSingle<MemberRow>();
  if (!member && email) {
    const existing = await admin.from("members").select("*").eq("email", email).maybeSingle<MemberRow>();
    member = existing.data;
    if (member) {
      const linked = await admin.from("members").update({ user_id: user.id, name: member.name || name }).eq("id", member.id).select("*").single<MemberRow>();
      if (linked.error) throw linked.error;
      member = linked.data;
    }
  }

  if (!member) {
    const created = await admin.from("members").insert({
      user_id: user.id,
      email,
      name,
      role: isOwner ? "service_supervisor" : "technician",
      requested_role: isOwner ? "service_supervisor" : null,
      approval_status: isOwner ? "approved" : "unregistered",
      active: isOwner,
      language: "en",
    }).select("*").single<MemberRow>();
    if (created.error) throw created.error;
    member = created.data;
  }

  if (isOwner && (member.role !== "service_supervisor" || member.approval_status !== "approved" || !member.active)) {
    const updated = await admin.from("members").update({
      role: "service_supervisor",
      requested_role: "service_supervisor",
      approval_status: "approved",
      active: true,
    }).eq("id", member.id).select("*").single<MemberRow>();
    if (updated.error) throw updated.error;
    member = updated.data;
  }

  return member;
}

export function memberForClient(member: MemberRow) {
  return {
    id: member.id,
    userId: member.user_id,
    email: member.email,
    name: member.name,
    role: member.role,
    requestedRole: member.requested_role,
    approvalStatus: member.approval_status,
    language: member.language,
    active: member.active,
    createdAt: member.created_at,
  };
}

export function isApproved(member: MemberRow) {
  return member.active && member.approval_status === "approved";
}

export function isServiceSupervisor(member: MemberRow) {
  return isApproved(member) && member.role === "service_supervisor";
}
