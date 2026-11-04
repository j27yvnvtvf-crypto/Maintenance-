import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getCurrentMember, isAdmin, isApproved, memberForClient,
  type MemberRow,
} from "@/lib/access";
import { canAdminActOn, canRequestAccess } from "@/lib/access-rules";

const priorities = ["low", "medium", "high", "emergency"];
const statuses = ["open", "assigned", "in_progress", "on_hold", "completed"];

type WorkOrderRow = {
  id: number; title: string; description: string; area: string; category: string;
  priority: string; status: string; assigned_to: number | null; due_date: string | null;
  completion_comment: string | null; resident_note: string | null;
  created_at: string; updated_at: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function jobForClient(job: WorkOrderRow, names: Map<number, string>) {
  return {
    id: job.id, title: job.title, description: job.description, area: job.area,
    category: job.category, priority: job.priority, status: job.status,
    assignedTo: job.assigned_to, assignedName: job.assigned_to ? names.get(job.assigned_to) || null : null,
    dueDate: job.due_date, completionComment: job.completion_comment,
    residentNote: job.resident_note, createdAt: job.created_at, updatedAt: job.updated_at,
  };
}

function failure(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (message === "APPROVAL_REQUIRED") {
    return NextResponse.json({ error: "Account approval required" }, { status: 403 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Append-only administrative audit trail. Failures here never mask the action result silently: they propagate. */
async function writeAudit(
  admin: AdminClient,
  actor: MemberRow,
  action: "approve_member" | "reject_member" | "suspend_member" | "revoke_member" | "add_member",
  target: MemberRow,
  detail: Record<string, unknown>,
) {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_user_id: actor.user_id,
    actor_member_id: actor.id,
    actor_email: actor.email,
    action,
    target_member_id: target.id,
    target_email: target.email,
    detail,
  });
  if (error) throw error;
}

export async function GET() {
  try {
    const me = await getCurrentMember();
    if (!isApproved(me)) {
      // Bootstrap payload ONLY: the account's own state so the UI can show
      // the pending / rejected / suspended screen. No team, no work orders,
      // no property data of any kind is included for unapproved accounts.
      return NextResponse.json({
        me: memberForClient(me),
        team: [],
        jobs: [],
        pendingTeam: [],
        auditLog: [],
        accessState: me.approval_status,
      });
    }
    const admin = createAdminClient();
    const [{ data: teamRows, error: teamError }, { data: jobRows, error: jobError }] = await Promise.all([
      admin.from("members").select("*").order("name"),
      admin.from("work_orders").select("*").order("created_at", { ascending: false }),
    ]);
    if (teamError) throw teamError;
    if (jobError) throw jobError;
    const allTeam = (teamRows || []) as MemberRow[];
    const names = new Map(allTeam.map((person) => [person.id, person.name]));
    // Every approved account sees the same operational data and the same
    // approved team list — permissions no longer depend on any role.
    const jobs = ((jobRows || []) as WorkOrderRow[]).map((job) => jobForClient(job, names));
    const team = allTeam.filter((person) => person.active && person.approval_status === "approved");
    // Administrative data (access requests, suspended accounts, audit log)
    // is included only for the administrator.
    let pendingTeam: MemberRow[] = [];
    let auditLog: unknown[] = [];
    if (isAdmin(me)) {
      pendingTeam = allTeam.filter((person) => !(person.active && person.approval_status === "approved"));
      const { data: logRows, error: logError } = await admin
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (logError) throw logError;
      auditLog = logRows || [];
    }
    return NextResponse.json({
      me: memberForClient(me),
      team: team.map(memberForClient),
      jobs,
      pendingTeam: pendingTeam.map(memberForClient),
      auditLog,
      accessState: "approved",
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient();
    const me = await getCurrentMember();
    const body = await req.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const now = new Date().toISOString();

    // --- Actions available before approval (identity and request only) ---
    if (body.action === "request_access") {
      // Submits or updates the access request: a free-text job title that is
      // informational only. It never grants permissions, whatever it says.
      const jobTitle = String(body.jobTitle || "").trim().slice(0, 120);
      const update: Record<string, unknown> = { job_title: jobTitle || null };
      if (canRequestAccess(me)) {
        update.approval_status = "pending";
        update.active = false;
      } else if (!isApproved(me)) {
        // Suspended / revoked accounts may update their title but cannot
        // reactivate themselves; only the administrator approves again.
        // (Approved accounts need no request and are left untouched.)
        if (me.approval_status !== "suspended" && me.approval_status !== "revoked") {
          return NextResponse.json({ error: "Access request is not available for this account state" }, { status: 400 });
        }
      }
      const { error } = await admin.from("members").update(update).eq("id", me.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "set_language") {
      const { error } = await admin.from("members").update({ language: body.language === "es" ? "es" : "en" }).eq("id", me.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // --- Everything below is a data or operational endpoint ---
    // Enforcement is per request, on the server, from the database state:
    // a suspended account with an open session gets 403 on its next call.
    if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");

    // --- Administrative actions: administrator only, never on oneself ---
    const adminActions = ["add_member", "approve_member", "reject_member", "suspend_member", "revoke_member"];
    if (adminActions.includes(String(body.action))) {
      if (!isAdmin(me)) throw new Error("FORBIDDEN");
      const action = String(body.action);

      if (action === "add_member") {
        // Pre-registers a person by email. The account is created PENDING:
        // it grants nothing until the person signs up and the administrator
        // approves. Only the administrator can do this.
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        const jobTitle = String(body.jobTitle || "").trim().slice(0, 120);
        if (!email || !name) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
        const existing = await admin.from("members").select("id").eq("email", email).maybeSingle();
        if (existing.data) return NextResponse.json({ error: "A member with this email already exists" }, { status: 409 });
        const { data, error } = await admin.from("members").insert({
          email, name, job_title: jobTitle || null,
          role: "technician", requested_role: null,
          approval_status: "pending", active: false, is_admin: false,
          language: body.language === "es" ? "es" : "en",
        }).select("*").single();
        if (error) throw error;
        await writeAudit(admin, me, "add_member", data as MemberRow, { jobTitle: jobTitle || null });
        return NextResponse.json({ member: memberForClient(data as MemberRow) });
      }

      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Member is required" }, { status: 400 });
      const targetResult = await admin.from("members").select("*").eq("id", id).maybeSingle<MemberRow>();
      if (targetResult.error) throw targetResult.error;
      const target = targetResult.data;
      if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      if (!canAdminActOn(me, target)) {
        return NextResponse.json({ error: "You cannot change your own access" }, { status: 400 });
      }
      const fromStatus = target.approval_status;

      if (action === "approve_member") {
        const { error } = await admin.from("members").update({ approval_status: "approved", active: true }).eq("id", id);
        if (error) throw error;
        await writeAudit(admin, me, "approve_member", target, { fromStatus });
        return NextResponse.json({ ok: true });
      }
      if (action === "reject_member") {
        const { error } = await admin.from("members").update({ approval_status: "rejected", active: false }).eq("id", id);
        if (error) throw error;
        await writeAudit(admin, me, "reject_member", target, { fromStatus });
        return NextResponse.json({ ok: true });
      }
      if (action === "suspend_member") {
        const { error } = await admin.from("members").update({ approval_status: "suspended", active: false }).eq("id", id);
        if (error) throw error;
        // Session enforcement: every API route re-reads the member state
        // from the database on each request (getCurrentMember), and all
        // property data flows through those routes — the browser never
        // holds a data-capable key (RLS denies anon/authenticated). An
        // already-open session therefore loses all access on its very next
        // request even though its auth cookie has not expired.
        await writeAudit(admin, me, "suspend_member", target, {
          fromStatus,
          enforcement: "per_request_state_check",
        });
        return NextResponse.json({ ok: true });
      }
      // revoke_member: definitive removal of access. The auth account is
      // deleted (which also destroys its sessions and refresh tokens) and
      // the member row is kept, marked 'revoked' and unlinked, so the
      // administrative history of the account is preserved.
      let authDeleted = false;
      if (target.user_id) {
        try {
          const { error: deleteError } = await admin.auth.admin.deleteUser(target.user_id);
          authDeleted = !deleteError;
        } catch {
          authDeleted = false;
        }
      }
      const { error } = await admin.from("members").update({ approval_status: "revoked", active: false, user_id: null }).eq("id", id);
      if (error) throw error;
      await writeAudit(admin, me, "revoke_member", target, { fromStatus, authUserDeleted: authDeleted });
      return NextResponse.json({ ok: true });
    }

    // --- Operational actions: identical for every approved account ---
    if (body.action === "create_job") {
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      if (!title || !description) return NextResponse.json({ error: "Title and details are required" }, { status: 400 });
      const assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
      let dueDate: string | null = null;
      if (body.dueDate) {
        if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
          return NextResponse.json({ error: "Due date must use YYYY-MM-DD format" }, { status: 400 });
        }
        dueDate = body.dueDate;
      }
      const { data, error } = await admin.from("work_orders").insert({
        title, description, area: String(body.area || "General Area"), category: String(body.category || "General Maintenance"),
        priority: priorities.includes(String(body.priority)) ? body.priority : "medium",
        status: assignedTo ? "assigned" : "open", assigned_to: assignedTo,
        due_date: dueDate, created_by: me.user_id, created_at: now, updated_at: now, updated_by: me.user_id,
      }).select("*").single();
      if (error) throw error;
      const created = data as WorkOrderRow;
      const names = new Map<number, string>();
      if (created.assigned_to) {
        const assignee = await admin.from("members").select("id, name").eq("id", created.assigned_to).maybeSingle();
        if (assignee.data) names.set(assignee.data.id, assignee.data.name);
      }
      return NextResponse.json({ job: jobForClient(created, names) });
    }

    if (body.action === "update_job") {
      // Any approved account may update and close any work order, whatever
      // its job title says. Closing never deletes the record.
      const id = Number(body.id);
      const current = await admin.from("work_orders").select("*").eq("id", id).maybeSingle<WorkOrderRow>();
      if (current.error) throw current.error;
      if (!current.data) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const nextStatus = statuses.includes(String(body.status)) ? String(body.status) : current.data.status;
      const update: Record<string, unknown> = {
        status: nextStatus,
        updated_at: now,
        updated_by: me.user_id,
      };
      if (body.assignedTo !== undefined) update.assigned_to = body.assignedTo ? Number(body.assignedTo) : null;
      if (body.completionComment !== undefined) update.completion_comment = String(body.completionComment || "");
      if (body.residentNote !== undefined) update.resident_note = String(body.residentNote || "");
      if (nextStatus === "completed" && current.data.status !== "completed") {
        update.closed_by = me.user_id;
        update.closed_at = now;
      }
      if (nextStatus !== "completed" && current.data.status === "completed") {
        update.closed_by = null;
        update.closed_at = null;
      }
      const { error } = await admin.from("work_orders").update(update).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
