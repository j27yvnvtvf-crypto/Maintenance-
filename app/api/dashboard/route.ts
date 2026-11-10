import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getCurrentMember, isAdmin, isApproved, memberForClient, memberForClientWithPhone,
  type MemberRow,
} from "@/lib/access";
import { canAdminActOn, canRequestAccess, isValidPhone, normalizePhone } from "@/lib/access-rules";
import {
  JOB_BUILDINGS,
  JOB_CATEGORIES,
  JOB_CATEGORY_KEYS,
  JOB_ORIGINS,
  JOB_STATUSES,
  isHoldStatus,
  validateClose,
  validateHold,
} from "@/lib/jobs-rules";
import { notesFingerprint } from "@/lib/notes-rules";

const priorities = ["low", "medium", "high", "emergency"];
const statuses: string[] = [...JOB_STATUSES];

type WorkOrderRow = {
  id: number; title: string; description: string; area: string; category: string;
  priority: string; status: string; assigned_to: number | null; due_date: string | null;
  completion_comment: string | null; resident_note: string | null;
  created_at: string; updated_at: string;
  record_type: string; origin: string; external_ref: string | null;
  building: string | null; unit: string | null; scheduled_date: string | null;
  findings: string | null; cause: string | null; action_performed: string | null;
  next_action: string | null;
  hold_reason: string | null; hold_follow_up_date: string | null;
  hold_follow_up_by: number | null;
  vendor_id: number | null;
  verification_action: string | null; verification_test: string | null;
  verification_result: string | null; verification_confirmed: boolean;
  verified_by_member_id: number | null; verified_by_user_id: string | null;
  verified_at: string | null;
  maintenance_comment_draft: string | null; resident_note_draft: string | null;
  notes_fingerprint: string | null; notes_updated_at: string | null;
  notes_updated_by: string | null;
  version: number;
  closed_by: string | null; closed_at: string | null; updated_by: string | null;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function jobForClient(
  job: WorkOrderRow,
  names: Map<number, string>,
  vendorNames: Map<number, string> = new Map(),
  collaborators: Map<number, number[]> = new Map(),
) {
  const name = (id: number | null) => (id ? names.get(id) || null : null);
  return {
    id: job.id, title: job.title, description: job.description, area: job.area,
    category: job.category, priority: job.priority, status: job.status,
    assignedTo: job.assigned_to, assignedName: name(job.assigned_to),
    dueDate: job.due_date, completionComment: job.completion_comment,
    residentNote: job.resident_note, createdAt: job.created_at, updatedAt: job.updated_at,
    recordType: job.record_type, origin: job.origin, externalRef: job.external_ref,
    building: job.building, unit: job.unit, scheduledDate: job.scheduled_date,
    findings: job.findings, cause: job.cause, actionPerformed: job.action_performed,
    nextAction: job.next_action,
    holdReason: job.hold_reason, holdFollowUpDate: job.hold_follow_up_date,
    holdFollowUpBy: job.hold_follow_up_by, holdFollowUpByName: name(job.hold_follow_up_by),
    vendorId: job.vendor_id,
    vendorName: job.vendor_id ? vendorNames.get(job.vendor_id) || null : null,
    verificationAction: job.verification_action, verificationTest: job.verification_test,
    verificationResult: job.verification_result,
    verificationConfirmed: job.verification_confirmed === true,
    verifiedByMemberId: job.verified_by_member_id,
    verifiedByUserId: job.verified_by_user_id,
    verifiedByName: name(job.verified_by_member_id),
    verifiedAt: job.verified_at,
    maintenanceCommentDraft: job.maintenance_comment_draft,
    residentNoteDraft: job.resident_note_draft,
    notesFingerprint: job.notes_fingerprint,
    notesUpdatedAt: job.notes_updated_at, notesUpdatedBy: job.notes_updated_by,
    version: job.version ?? 1,
    collaboratorIds: collaborators.get(job.id) || [],
  };
}

function textField(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function dateField(value: unknown): string | null | "INVALID" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  return text;
}

/** Category keys are canonical; a known ES/EN label maps to its key. */
function resolveCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (JOB_CATEGORY_KEYS.includes(text)) return text;
  const lower = text.toLowerCase();
  const byLabel = JOB_CATEGORIES.find(
    (c) => c.es.toLowerCase() === lower || c.en.toLowerCase() === lower,
  );
  return byLabel ? byLabel.key : null;
}

function resolveBuilding(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return JOB_BUILDINGS.includes(text) ? text : null;
}

function resolveOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return (JOB_ORIGINS as string[]).includes(value) ? value : null;
}

/** Append-only work order history: the ONLY write this route makes to it. */
async function writeJobHistory(
  admin: AdminClient,
  actor: MemberRow,
  workOrderId: number,
  action: string,
  detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("work_order_history").insert({
    work_order_id: workOrderId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

async function jobContext(admin: AdminClient) {
  const [{ data: memberRows, error: memberError }, { data: vendorRows, error: vendorError }] =
    await Promise.all([
      admin.from("members").select("id, name"),
      admin.from("vendors").select("id, company_name"),
    ]);
  if (memberError) throw memberError;
  if (vendorError) throw vendorError;
  const names = new Map(
    ((memberRows || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]),
  );
  const vendorNames = new Map(
    ((vendorRows || []) as { id: number; company_name: string }[]).map((v) => [v.id, v.company_name]),
  );
  return { names, vendorNames };
}

async function collaboratorsFor(admin: AdminClient, jobIds: number[]) {
  const map = new Map<number, number[]>();
  if (!jobIds.length) return map;
  const { data, error } = await admin
    .from("work_order_collaborators")
    .select("work_order_id, member_id")
    .in("work_order_id", jobIds);
  if (error) throw error;
  for (const row of (data || []) as { work_order_id: number; member_id: number }[]) {
    map.set(row.work_order_id, [...(map.get(row.work_order_id) || []), row.member_id]);
  }
  return map;
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
      // `me` carries the owner's own phone so they can review and correct
      // their request data — it is their own personal data, nobody else's.
      return NextResponse.json({
        me: memberForClientWithPhone(me),
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
    const { data: vendorRows, error: vendorError } = await admin
      .from("vendors").select("id, company_name");
    if (vendorError) throw vendorError;
    const vendorNames = new Map(
      ((vendorRows || []) as { id: number; company_name: string }[]).map((v) => [v.id, v.company_name]),
    );
    const jobRowsTyped = (jobRows || []) as WorkOrderRow[];
    const collaborators = await collaboratorsFor(admin, jobRowsTyped.map((job) => job.id));
    // Every approved account sees the same operational data and the same
    // approved team list — permissions no longer depend on any role.
    const jobs = jobRowsTyped.map((job) => jobForClient(job, names, vendorNames, collaborators));
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
      me: memberForClientWithPhone(me),
      // Team list: the phone-free payload. No non-administrator ever
      // receives another member's personal phone from this endpoint.
      team: team.map(memberForClient),
      jobs,
      // Administrator-only section: pending/inactive accounts WITH their
      // verification phone, so the administrator can confirm identities.
      pendingTeam: pendingTeam.map(memberForClientWithPhone),
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
      // Submits or updates the access request with the identity data the
      // administrator uses to verify the person: full name, personal phone
      // and a free-text job title. None of it grants permissions: the job
      // title is informational only, whatever it says, and the phone is a
      // verification datum visible only to the administrator.
      const name = String(body.name || "").trim().slice(0, 120);
      const jobTitle = String(body.jobTitle || "").trim().slice(0, 120);
      const update: Record<string, unknown> = { job_title: jobTitle || null };
      if (canRequestAccess(me)) {
        // A (re)submitted request must carry complete, valid identity data:
        // the registration name and a reachable personal phone.
        if (!name) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
        if (!isValidPhone(body.phone)) {
          return NextResponse.json({ error: "Enter a valid personal phone number (7 to 15 digits)" }, { status: 400 });
        }
        update.name = name;
        update.phone = normalizePhone(body.phone);
        update.approval_status = "pending";
        update.active = false;
      } else if (!isApproved(me)) {
        // Suspended / revoked accounts may correct their data but cannot
        // reactivate themselves; only the administrator approves again.
        // (Approved accounts need no request and are left untouched.)
        if (me.approval_status !== "suspended" && me.approval_status !== "revoked") {
          return NextResponse.json({ error: "Access request is not available for this account state" }, { status: 400 });
        }
        if (name) update.name = name;
        if (body.phone !== undefined && String(body.phone).trim() !== "") {
          if (!isValidPhone(body.phone)) {
            return NextResponse.json({ error: "Enter a valid personal phone number (7 to 15 digits)" }, { status: 400 });
          }
          update.phone = normalizePhone(body.phone);
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
      const dueDate = dateField(body.dueDate);
      const scheduledDate = dateField(body.scheduledDate);
      const holdFollowUpDate = dateField(body.holdFollowUpDate);
      if (dueDate === "INVALID" || scheduledDate === "INVALID" || holdFollowUpDate === "INVALID") {
        return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
      }
      // Structured Phase 5 fields, validated against lib/jobs-rules.ts
      // constants; anything invalid falls back safely (priority pattern).
      const recordType = body.recordType === "task" ? "task" : "work_order";
      const origin = resolveOrigin(body.origin) || "daily_operation";
      const category = resolveCategory(body.category) || "general";
      const building = resolveBuilding(body.building);
      let status = "open";
      if (typeof body.status === "string" && statuses.includes(body.status)
        && body.status !== "assigned" && body.status !== "completed") {
        status = body.status;
      }
      const draft = {
        status,
        holdReason: textField(body.holdReason, 2000),
        holdFollowUpDate,
        holdFollowUpBy: body.holdFollowUpBy ? Number(body.holdFollowUpBy) : null,
        nextAction: textField(body.nextAction, 2000),
      };
      if (isHoldStatus(status)) {
        const holdErrorsList = validateHold(draft);
        if (holdErrorsList.length) {
          return NextResponse.json(
            { error: "HOLD_FIELDS_REQUIRED", fields: holdErrorsList },
            { status: 400 },
          );
        }
      }
      const { data, error } = await admin.from("work_orders").insert({
        title, description, area: String(body.area || "General Area"), category,
        priority: priorities.includes(String(body.priority)) ? body.priority : "medium",
        status, assigned_to: assignedTo,
        due_date: dueDate, created_by: me.user_id, created_at: now, updated_at: now, updated_by: me.user_id,
        record_type: recordType, origin, external_ref: textField(body.externalRef, 200),
        building, unit: textField(body.unit, 60), scheduled_date: scheduledDate,
        findings: textField(body.findings, 5000), cause: textField(body.cause, 5000),
        action_performed: textField(body.actionPerformed, 5000),
        next_action: draft.nextAction,
        hold_reason: draft.holdReason, hold_follow_up_date: draft.holdFollowUpDate,
        hold_follow_up_by: draft.holdFollowUpBy,
        vendor_id: body.vendorId ? Number(body.vendorId) : null,
      }).select("*").single();
      if (error) throw error;
      const created = data as WorkOrderRow;
      await writeJobHistory(admin, me, created.id, "created", {
        recordType, origin, status,
      });
      // Initial collaborators (deduplicated; the assignee is separate).
      const collaboratorIds = [...new Set(
        (Array.isArray(body.collaboratorIds) ? body.collaboratorIds : [])
          .map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0),
      )];
      if (collaboratorIds.length) {
        const { error: collabError } = await admin.from("work_order_collaborators").insert(
          collaboratorIds.map((memberId) => ({
            work_order_id: created.id, member_id: memberId, added_by_member_id: me.id,
          })),
        );
        if (collabError) throw collabError;
        for (const memberId of collaboratorIds) {
          await writeJobHistory(admin, me, created.id, "collaborator_added", { memberId });
        }
      }
      const { names, vendorNames } = await jobContext(admin);
      const collaborators = await collaboratorsFor(admin, [created.id]);
      return NextResponse.json({ job: jobForClient(created, names, vendorNames, collaborators) });
    }

    if (body.action === "update_job") {
      // Any approved account may update and close any work order, whatever
      // its job title says. Closing never deletes the record. Phase 5
      // enforcement lives HERE, on the server: holds demand their four
      // recorded facts (validateHold), closings demand a recorded
      // verification (validateClose), verified_* are written only by the
      // server at the closing moment, and optimistic locking rejects a
      // save based on a stale version with 409.
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Work order is required" }, { status: 400 });
      const currentResult = await admin.from("work_orders").select("*").eq("id", id).maybeSingle<WorkOrderRow>();
      if (currentResult.error) throw currentResult.error;
      const current = currentResult.data;
      if (!current) return NextResponse.json({ error: "Work order not found" }, { status: 404 });

      // Optimistic locking: a client saving against a version it never
      // saw loses cleanly instead of overwriting the newer save.
      if (body.version !== undefined && body.version !== null
        && Number(body.version) !== (current.version ?? 1)) {
        return NextResponse.json({ error: "VERSION_CONFLICT" }, { status: 409 });
      }

      // Merged next state: current values overlaid with the request's.
      // verified_* / verifiedBy / verifiedAt keys in the body are IGNORED
      // on purpose — verification is a server act, never client input.
      // Cost fields are not part of this action at all (see /api/quotes).
      const merged = {
        title: current.title, description: current.description, area: current.area,
        category: current.category, priority: current.priority, status: current.status,
        assignedTo: current.assigned_to, dueDate: current.due_date,
        scheduledDate: current.scheduled_date, building: current.building,
        unit: current.unit, origin: current.origin, externalRef: current.external_ref,
        findings: current.findings, cause: current.cause,
        actionPerformed: current.action_performed, nextAction: current.next_action,
        vendorId: current.vendor_id,
        holdReason: current.hold_reason, holdFollowUpDate: current.hold_follow_up_date,
        holdFollowUpBy: current.hold_follow_up_by,
        verificationAction: current.verification_action,
        verificationTest: current.verification_test,
        verificationResult: current.verification_result,
        verificationConfirmed: current.verification_confirmed === true,
        completionComment: current.completion_comment, residentNote: current.resident_note,
      };
      if (body.title !== undefined) {
        const title = String(body.title || "").trim();
        if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        merged.title = title;
      }
      if (body.description !== undefined) merged.description = String(body.description || "");
      if (body.area !== undefined) merged.area = String(body.area || "");
      if (body.category !== undefined) merged.category = resolveCategory(body.category) || current.category;
      if (body.priority !== undefined) {
        merged.priority = priorities.includes(String(body.priority)) ? String(body.priority) : current.priority;
      }
      if (body.status !== undefined) {
        const requested = String(body.status);
        // 'assigned' is a legacy read value: asking for it means "open".
        merged.status = statuses.includes(requested)
          ? (requested === "assigned" ? "open" : requested)
          : current.status;
      }
      if (body.assignedTo !== undefined) merged.assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
      if (body.vendorId !== undefined) merged.vendorId = body.vendorId ? Number(body.vendorId) : null;
      if (body.holdFollowUpBy !== undefined) merged.holdFollowUpBy = body.holdFollowUpBy ? Number(body.holdFollowUpBy) : null;
      if (body.origin !== undefined) merged.origin = resolveOrigin(body.origin) || current.origin;
      if (body.building !== undefined) merged.building = resolveBuilding(body.building);
      const textOverlay: [string, keyof typeof merged, number][] = [
        ["unit", "unit", 60], ["externalRef", "externalRef", 200],
        ["findings", "findings", 5000], ["cause", "cause", 5000],
        ["actionPerformed", "actionPerformed", 5000], ["nextAction", "nextAction", 2000],
        ["holdReason", "holdReason", 2000],
        ["verificationAction", "verificationAction", 5000],
        ["verificationTest", "verificationTest", 5000],
        ["verificationResult", "verificationResult", 5000],
        ["completionComment", "completionComment", 5000],
        ["residentNote", "residentNote", 5000],
      ];
      for (const [input, field, max] of textOverlay) {
        if (body[input] !== undefined) {
          (merged as Record<string, unknown>)[field] = textField(body[input], max);
        }
      }
      for (const [input, field] of [
        ["dueDate", "dueDate"], ["scheduledDate", "scheduledDate"],
        ["holdFollowUpDate", "holdFollowUpDate"],
      ] as const) {
        if (body[input] !== undefined) {
          const parsed = dateField(body[input]);
          if (parsed === "INVALID") {
            return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
          }
          (merged as Record<string, unknown>)[field] = parsed;
        }
      }
      if (body.verificationConfirmed !== undefined) {
        merged.verificationConfirmed = body.verificationConfirmed === true;
      }

      const nextStatus = merged.status;
      const statusChanging = nextStatus !== current.status;
      const enteringHold = isHoldStatus(nextStatus) && !isHoldStatus(current.status);
      const leavingHold = isHoldStatus(current.status) && !isHoldStatus(nextStatus);
      const closing = nextStatus === "completed" && current.status !== "completed";
      const reopening = current.status === "completed" && nextStatus !== "completed";

      // Hold gate: the four recorded facts, enforced on the merged state
      // whenever the resulting status is any kind of hold.
      if (isHoldStatus(nextStatus)) {
        const fields = validateHold(merged);
        if (fields.length) {
          return NextResponse.json({ error: "HOLD_FIELDS_REQUIRED", fields }, { status: 400 });
        }
      }
      // Closing gate: no verification, no closing. Ever.
      if (closing) {
        const fields = validateClose(merged);
        if (fields.length) {
          return NextResponse.json({ error: "VERIFICATION_REQUIRED", fields }, { status: 400 });
        }
      }
      // A completed job may only reopen (to open / in progress).
      if (reopening && nextStatus !== "open" && nextStatus !== "in_progress") {
        return NextResponse.json(
          { error: "A completed work order can only be reopened to open or in progress" },
          { status: 400 },
        );
      }

      const update: Record<string, unknown> = {
        title: merged.title, description: merged.description, area: merged.area,
        category: merged.category, priority: merged.priority, status: nextStatus,
        assigned_to: merged.assignedTo, due_date: merged.dueDate,
        scheduled_date: merged.scheduledDate, building: merged.building,
        unit: merged.unit, origin: merged.origin, external_ref: merged.externalRef,
        findings: merged.findings, cause: merged.cause,
        action_performed: merged.actionPerformed, next_action: merged.nextAction,
        vendor_id: merged.vendorId,
        hold_reason: merged.holdReason, hold_follow_up_date: merged.holdFollowUpDate,
        hold_follow_up_by: merged.holdFollowUpBy,
        verification_action: merged.verificationAction,
        verification_test: merged.verificationTest,
        verification_result: merged.verificationResult,
        verification_confirmed: merged.verificationConfirmed,
        completion_comment: merged.completionComment,
        resident_note: merged.residentNote,
        updated_at: now,
        updated_by: me.user_id,
        version: (current.version ?? 1) + 1,
      };
      if (closing) {
        update.verified_by_member_id = me.id;
        update.verified_by_user_id = me.user_id;
        update.verified_at = now;
        update.closed_by = me.user_id;
        update.closed_at = now;
      }
      if (reopening) {
        // The current verification is cleared; the history rows below
        // preserve who verified and when. A new closing will demand a
        // new verification (validateClose runs again on that request).
        update.verified_by_member_id = null;
        update.verified_by_user_id = null;
        update.verified_at = null;
        update.verification_confirmed = false;
        update.closed_by = null;
        update.closed_at = null;
      }
      let updateQuery = admin.from("work_orders").update(update).eq("id", id);
      if (body.version !== undefined && body.version !== null) {
        updateQuery = updateQuery.eq("version", current.version ?? 1);
      }
      const { data: updatedRows, error } = await updateQuery.select("id");
      if (error) throw error;
      if (body.version !== undefined && body.version !== null
        && (!updatedRows || updatedRows.length === 0)) {
        return NextResponse.json({ error: "VERSION_CONFLICT" }, { status: 409 });
      }

      // --- Append-only history for everything this update changed ---
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const scalarFields: [keyof typeof merged, string][] = [
        ["title", "title"], ["description", "description"], ["area", "area"],
        ["category", "category"], ["priority", "priority"], ["dueDate", "due_date"],
        ["scheduledDate", "scheduled_date"], ["building", "building"], ["unit", "unit"],
        ["origin", "origin"], ["externalRef", "external_ref"], ["findings", "findings"],
        ["cause", "cause"], ["actionPerformed", "action_performed"],
        ["nextAction", "next_action"], ["vendorId", "vendor_id"],
        ["holdReason", "hold_reason"], ["holdFollowUpDate", "hold_follow_up_date"],
        ["holdFollowUpBy", "hold_follow_up_by"],
        ["verificationAction", "verification_action"],
        ["verificationTest", "verification_test"],
        ["verificationResult", "verification_result"],
        ["completionComment", "completion_comment"], ["residentNote", "resident_note"],
      ];
      const before: Record<string, unknown> = {
        title: current.title, description: current.description, area: current.area,
        category: current.category, priority: current.priority, dueDate: current.due_date,
        scheduledDate: current.scheduled_date, building: current.building,
        unit: current.unit, origin: current.origin, externalRef: current.external_ref,
        findings: current.findings, cause: current.cause,
        actionPerformed: current.action_performed, nextAction: current.next_action,
        vendorId: current.vendor_id, holdReason: current.hold_reason,
        holdFollowUpDate: current.hold_follow_up_date,
        holdFollowUpBy: current.hold_follow_up_by,
        verificationAction: current.verification_action,
        verificationTest: current.verification_test,
        verificationResult: current.verification_result,
        completionComment: current.completion_comment,
        residentNote: current.resident_note,
      };
      for (const [field] of scalarFields) {
        const from = before[field];
        const to = (merged as Record<string, unknown>)[field];
        if (from !== to) changes[field] = { from: from ?? null, to: to ?? null };
      }
      if (Object.keys(changes).length) {
        await writeJobHistory(admin, me, id, "details_updated", { changes });
      }
      if (merged.assignedTo !== current.assigned_to) {
        await writeJobHistory(admin, me, id, "assigned", {
          from: current.assigned_to, to: merged.assignedTo,
        });
      }
      if (statusChanging) {
        await writeJobHistory(admin, me, id, "status_changed", {
          from: current.status, to: nextStatus,
        });
      }
      if (enteringHold || (isHoldStatus(nextStatus) && isHoldStatus(current.status)
        && (changes.holdReason || changes.holdFollowUpDate || changes.holdFollowUpBy || changes.nextAction))) {
        await writeJobHistory(admin, me, id, "hold_set", {
          from: current.status, to: nextStatus,
          holdReason: merged.holdReason, holdFollowUpDate: merged.holdFollowUpDate,
          holdFollowUpBy: merged.holdFollowUpBy, nextAction: merged.nextAction,
        });
      }
      if (leavingHold && !closing) {
        await writeJobHistory(admin, me, id, "hold_cleared", {
          from: current.status, to: nextStatus,
        });
      }
      if (closing) {
        await writeJobHistory(admin, me, id, "verification_recorded", {
          verificationAction: merged.verificationAction,
          verificationTest: merged.verificationTest,
          verificationResult: merged.verificationResult,
          verifiedByMemberId: me.id, verifiedAt: now,
        });
        await writeJobHistory(admin, me, id, "completed", {
          from: current.status, to: "completed",
        });
      }
      if (reopening) {
        await writeJobHistory(admin, me, id, "reopened", {
          from: "completed", to: nextStatus,
          previousVerifiedByMemberId: current.verified_by_member_id,
          previousVerifiedAt: current.verified_at,
        });
      }

      const { data: fresh, error: freshError } = await admin
        .from("work_orders").select("*").eq("id", id).maybeSingle<WorkOrderRow>();
      if (freshError) throw freshError;
      const { names, vendorNames } = await jobContext(admin);
      const collaborators = await collaboratorsFor(admin, [id]);
      return NextResponse.json({
        ok: true,
        job: fresh ? jobForClient(fresh, names, vendorNames, collaborators) : null,
      });
    }

    if (body.action === "save_note_drafts") {
      // Guided-note drafts (lib/notes-rules.ts) are stored WITH the job,
      // stamped with the fingerprint of the facts they were generated
      // from, so the UI can flag a draft as stale when the facts change.
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Work order is required" }, { status: 400 });
      const currentResult = await admin.from("work_orders").select("*").eq("id", id).maybeSingle<WorkOrderRow>();
      if (currentResult.error) throw currentResult.error;
      const current = currentResult.data;
      if (!current) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const { names, vendorNames } = await jobContext(admin);
      const client = jobForClient(current, names, vendorNames, new Map());
      const fingerprint = notesFingerprint(client);
      const nextVersion = (current.version ?? 1) + 1;
      const { error } = await admin.from("work_orders").update({
        maintenance_comment_draft: textField(body.maintenanceComment, 8000),
        resident_note_draft: textField(body.residentNote, 8000),
        notes_fingerprint: fingerprint,
        notes_updated_at: now,
        notes_updated_by: me.user_id,
        updated_at: now,
        updated_by: me.user_id,
        version: nextVersion,
      }).eq("id", id);
      if (error) throw error;
      await writeJobHistory(admin, me, id, "note_draft_saved", { notesFingerprint: fingerprint });
      return NextResponse.json({ ok: true, notesFingerprint: fingerprint, version: nextVersion });
    }

    if (body.action === "add_collaborator" || body.action === "remove_collaborator") {
      const id = Number(body.id);
      const memberId = Number(body.memberId);
      if (!id || !memberId) {
        return NextResponse.json({ error: "Work order and member are required" }, { status: 400 });
      }
      const currentResult = await admin.from("work_orders").select("id").eq("id", id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      if (!currentResult.data) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      if (body.action === "add_collaborator") {
        const memberResult = await admin.from("members")
          .select("id, approval_status, active").eq("id", memberId)
          .maybeSingle<{ id: number; approval_status: string; active: boolean }>();
        if (memberResult.error) throw memberResult.error;
        if (!memberResult.data || memberResult.data.approval_status !== "approved"
          || memberResult.data.active !== true) {
          return NextResponse.json({ error: "Collaborator is not an approved account" }, { status: 400 });
        }
        const existing = await admin.from("work_order_collaborators")
          .select("id").eq("work_order_id", id).eq("member_id", memberId).maybeSingle();
        if (existing.error) throw existing.error;
        if (!existing.data) {
          const { error } = await admin.from("work_order_collaborators").insert({
            work_order_id: id, member_id: memberId, added_by_member_id: me.id,
          });
          if (error) throw error;
          await writeJobHistory(admin, me, id, "collaborator_added", { memberId });
        }
      } else {
        const { error } = await admin.from("work_order_collaborators")
          .delete().eq("work_order_id", id).eq("member_id", memberId);
        if (error) throw error;
        await writeJobHistory(admin, me, id, "collaborator_removed", { memberId });
      }
      const collaborators = await collaboratorsFor(admin, [id]);
      return NextResponse.json({ ok: true, collaboratorIds: collaborators.get(id) || [] });
    }

    if (body.action === "job_history") {
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Work order is required" }, { status: 400 });
      const currentResult = await admin.from("work_orders").select("id").eq("id", id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      if (!currentResult.data) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const { data: historyRows, error } = await admin
        .from("work_order_history").select("*").eq("work_order_id", id)
        .order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      const { names } = await jobContext(admin);
      type JobHistoryRow = {
        id: number; action: string; detail: Record<string, unknown>;
        actor_member_id: number | null; actor_email: string; created_at: string;
      };
      return NextResponse.json({
        history: ((historyRows || []) as JobHistoryRow[]).map((entry) => ({
          id: entry.id,
          action: entry.action,
          detail: entry.detail,
          actorMemberId: entry.actor_member_id,
          actorName: entry.actor_member_id ? names.get(entry.actor_member_id) || null : null,
          actorEmail: entry.actor_email,
          createdAt: entry.created_at,
        })),
      });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
