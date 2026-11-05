import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, type MemberRow } from "@/lib/access";
import { localDate } from "@/lib/time";
import {
  VENDOR_JOB_KINDS,
  VENDOR_JOB_STATUSES,
  canAccessVendors,
  canCompleteVendorJob,
  canVerifyVendorJob,
  isNextActionOverdue,
  type VendorJobKind,
  type VendorJobStatus,
} from "@/lib/inventory-vendors-rules";

/*
 * Vendors API (Phase 3B) — server-only, Phase 0 access rules:
 *   - only approved + active members can read or act here
 *   - pending / rejected / suspended / revoked accounts get 403 and no data
 *   - every change is written to an append-only history table
 *   - attachments live in the private "vendors" bucket; downloads go through
 *     /api/vendors/download with a fresh check and a short signed URL
 * Vendor jobs link to logbook events, work orders and assets without
 * duplicating them: a vendor visit recorded once in the logbook can be the
 * same event a job points to.
 *
 * Working-state transitions live here (open ↔ scheduled ↔ in_progress,
 * cancellable from any working state); completion and verification are
 * gated by the pure rules in lib/inventory-vendors-rules.ts so the verify
 * suite tests the exact decisions this route makes.
 */

const WORKING_TRANSITIONS: Record<string, string[]> = {
  open: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["open", "in_progress", "cancelled"],
  in_progress: ["open", "scheduled", "cancelled"],
  completed: [],
  verified: [],
  cancelled: [],
};

type DbClient = ReturnType<typeof createAdminClient>;

type VendorRow = {
  id: number;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  specialty: string | null;
  notes: string | null;
  status: string;
  created_by_member_id: number | null;
  created_at: string;
  updated_at: string;
};

type VendorJobRow = {
  id: number;
  vendor_id: number;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_date: string | null;
  related_location: string | null;
  asset_id: number | null;
  equipment_text: string | null;
  responsible_member_id: number | null;
  next_action: string | null;
  next_action_date: string | null;
  work_order_id: number | null;
  log_event_id: number | null;
  created_by_member_id: number | null;
  completed_by_member_id: number | null;
  completed_at: string | null;
  verified_by_member_id: number | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type AttachmentRow = {
  id: number;
  vendor_job_id: number;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  file_size: number | null;
  uploaded_by_member_id: number | null;
  created_at: string;
};

type HistoryRow = {
  id: number;
  vendor_job_id: number | null;
  action: string;
  detail: Record<string, unknown> | null;
  actor_member_id: number | null;
  actor_email: string | null;
  created_at: string;
};

function forbidden() {
  return NextResponse.json({ error: "Account not approved" }, { status: 403 });
}

function failure(error: unknown) {
  if (error instanceof Error && error.message === "NOT_APPROVED") return forbidden();
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}

async function requireOperationalMember(): Promise<MemberRow> {
  const me = await getCurrentMember();
  if (!me || !canAccessVendors(me)) throw new Error("NOT_APPROVED");
  return me;
}

function textField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

function parseDateField(value: unknown): string | null | "INVALID" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "INVALID";
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) return "INVALID";
  return trimmed;
}

async function memberNames(admin: DbClient, ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0))];
  const map = new Map<number, string>();
  if (!unique.length) return map;
  const { data } = await admin.from("members").select("id, name, email").in("id", unique);
  for (const row of (data || []) as { id: number; name: string | null; email: string }[]) {
    map.set(row.id, row.name || row.email);
  }
  return map;
}

async function vendorNames(admin: DbClient, ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0))];
  const map = new Map<number, string>();
  if (!unique.length) return map;
  const { data } = await admin.from("vendors").select("id, company_name").in("id", unique);
  for (const row of (data || []) as { id: number; company_name: string }[]) map.set(row.id, row.company_name);
  return map;
}

async function getVendorOr404(admin: DbClient, id: number) {
  if (!id) return null;
  const { data } = await admin.from("vendors").select("*").eq("id", id).maybeSingle<VendorRow>();
  return data;
}

async function getJobOr404(admin: DbClient, id: number) {
  if (!id) return null;
  const { data } = await admin.from("vendor_jobs").select("*").eq("id", id).maybeSingle<VendorJobRow>();
  return data;
}

async function requireAssignableMember(admin: DbClient, memberId: number | null) {
  if (!memberId) return true;
  const { data } = await admin.from("members")
    .select("id, approval_status, active")
    .eq("id", memberId)
    .maybeSingle<{ id: number; approval_status: string; active: boolean }>();
  return Boolean(data && data.approval_status === "approved" && data.active);
}

async function writeHistory(
  admin: DbClient, me: MemberRow, vendorId: number, jobId: number | null,
  action: string, detail?: Record<string, unknown>,
) {
  const { error } = await admin.from("vendor_history").insert({
    vendor_id: vendorId,
    vendor_job_id: jobId,
    action,
    detail: detail ?? {},
    actor_member_id: me.id,
    actor_user_id: me.user_id,
    actor_email: me.email,
  });
  if (error) throw error;
}

function vendorForClient(row: VendorRow) {
  return {
    id: row.id,
    company: row.company_name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    specialty: row.specialty,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobForClient(row: VendorJobRow, names: Map<number, string>, vendors: Map<number, string>) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: vendors.get(row.vendor_id) || "",
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    scheduledDate: row.scheduled_date,
    relatedLocation: row.related_location,
    relatedAssetId: row.asset_id,
    equipmentText: row.equipment_text,
    responsibleMemberId: row.responsible_member_id,
    responsibleName: row.responsible_member_id ? names.get(row.responsible_member_id) || "" : "",
    nextAction: row.next_action,
    nextActionDate: row.next_action_date,
    nextActionOverdue: isNextActionOverdue(
      { status: row.status as VendorJobStatus, next_action_date: row.next_action_date },
      localDate(),
    ),
    relatedWorkOrderId: row.work_order_id,
    relatedLogEventId: row.log_event_id,
    completedAt: row.completed_at,
    completedByName: row.completed_by_member_id ? names.get(row.completed_by_member_id) || "" : "",
    verifiedAt: row.verified_at,
    verifiedByName: row.verified_by_member_id ? names.get(row.verified_by_member_id) || "" : "",
    createdByName: row.created_by_member_id ? names.get(row.created_by_member_id) || "" : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------- GET ------------------------------- */

export async function GET(req: NextRequest) {
  try {
    await requireOperationalMember();
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;
    const jobId = Number(params.get("jobId") || 0);

    const { data: members, error: membersError } = await admin
      .from("members").select("id, name, email")
      .eq("approval_status", "approved").eq("active", true).order("name");
    if (membersError) throw membersError;
    const team = (members || []).map((m) => ({ id: m.id, name: m.name || m.email }));

    if (jobId) {
      const job = await getJobOr404(admin, jobId);
      if (!job) return NextResponse.json({ error: "Vendor job not found" }, { status: 404 });

      const [{ data: attachments }, { data: historyRows }] = await Promise.all([
        admin.from("vendor_attachments").select("*").eq("vendor_job_id", job.id)
          .order("created_at", { ascending: false }).returns<AttachmentRow[]>(),
        admin.from("vendor_history").select("*").eq("vendor_job_id", job.id)
          .order("id", { ascending: false }).returns<HistoryRow[]>(),
      ]);
      const names = await memberNames(admin, [
        job.responsible_member_id, job.completed_by_member_id, job.verified_by_member_id,
        job.created_by_member_id,
        ...(attachments || []).map((row) => row.uploaded_by_member_id),
        ...(historyRows || []).map((row) => row.actor_member_id),
      ]);
      const vendors = await vendorNames(admin, [job.vendor_id]);

      // Link options: logbook events not already used by another job, and assets.
      const [{ data: usedRows }, { data: eventRows }, { data: assetRows }] = await Promise.all([
        admin.from("vendor_jobs").select("log_event_id")
          .not("log_event_id", "is", null).returns<{ log_event_id: number | null }[]>(),
        admin.from("log_events").select("id, folio, description")
          .order("id", { ascending: false }).limit(200)
          .returns<{ id: number; folio: string; description: string }[]>(),
        admin.from("assets").select("id, name, status").order("name")
          .returns<{ id: number; name: string; status: string }[]>(),
      ]);
      const used = new Set((usedRows || []).map((row) => row.log_event_id));
      const eventOptions = (eventRows || [])
        .filter((row) => !used.has(row.id) || row.id === job.log_event_id)
        .map((row) => ({ id: row.id, label: `${row.folio} — ${row.description.slice(0, 60)}` }));
      return NextResponse.json({
        job: {
          ...jobForClient(job, names, vendors),
          attachments: (attachments || []).map((row) => ({
            id: row.id,
            fileName: row.file_name,
            contentType: row.content_type,
            fileSize: row.file_size,
            uploadedByName: row.uploaded_by_member_id ? names.get(row.uploaded_by_member_id) || "" : "",
            uploadedAt: row.created_at,
          })),
          history: (historyRows || []).map((row) => ({
            id: row.id,
            action: row.action,
            detail: row.detail,
            actorName: row.actor_member_id ? names.get(row.actor_member_id) || row.actor_email || "" : row.actor_email || "",
            createdAt: row.created_at,
          })),
        },
        eventOptions,
        assetOptions: (assetRows || []).map((row) => ({ id: row.id, name: row.name, status: row.status })),
        team,
      });
    }

    const [vendorsResult, jobsResult] = await Promise.all([
      admin.from("vendors").select("*").order("status").order("company_name").returns<VendorRow[]>(),
      admin.from("vendor_jobs").select("*").order("updated_at", { ascending: false })
        .limit(500).returns<VendorJobRow[]>(),
    ]);
    if (vendorsResult.error) throw vendorsResult.error;
    if (jobsResult.error) throw jobsResult.error;

    const names = await memberNames(admin, [
      ...(jobsResult.data || []).map((row) => row.responsible_member_id),
      ...(jobsResult.data || []).map((row) => row.verified_by_member_id),
    ]);
    const vendors = await vendorNames(admin, (jobsResult.data || []).map((row) => row.vendor_id));

    return NextResponse.json({
      vendors: (vendorsResult.data || []).map(vendorForClient),
      jobs: (jobsResult.data || []).map((row) => jobForClient(row, names, vendors)),
      team,
    });
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------- POST ------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const contentType = req.headers.get("content-type") || "";
    const now = new Date().toISOString();

    /* ---------------- Attachment upload (multipart) ---------------- */
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const jobId = Number(form.get("jobId") || 0);
      const job = await getJobOr404(admin, jobId);
      if (!job) return NextResponse.json({ error: "Vendor job not found" }, { status: 404 });
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Attach a non-empty file" }, { status: 400 });
      }
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File is larger than 15 MB" }, { status: 400 });
      }
      const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
      const storagePath = `${job.id}/${Date.now()}-${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage.from("vendors").upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream", upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: attachment, error } = await admin.from("vendor_attachments").insert({
        vendor_job_id: job.id,
        storage_path: storagePath,
        file_name: file.name.slice(0, 200),
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by_member_id: me.id,
        uploaded_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeHistory(admin, me, job.vendor_id, job.id, "attachment_added", { fileName: file.name });
      return NextResponse.json({ attachmentId: attachment.id });
    }

    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || "");

    /* ---------------- Directory ---------------- */

    if (action === "create_vendor") {
      const company = textField(body.company, 200);
      if (!company) return NextResponse.json({ error: "Company name is required" }, { status: 400 });
      const { data: created, error } = await admin.from("vendors").insert({
        company_name: company,
        contact_name: textField(body.contactName, 160),
        phone: textField(body.phone, 60),
        email: textField(body.email, 200),
        specialty: textField(body.specialty, 160),
        notes: textField(body.notes, 3000),
        status: "active",
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeHistory(admin, me, created.id, null, "vendor_created", { company });
      return NextResponse.json({ vendorId: created.id });
    }

    if (action === "update_vendor") {
      const vendor = await getVendorOr404(admin, Number(body.id || 0));
      if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.company !== undefined) {
        const company = textField(body.company, 200);
        if (!company) return NextResponse.json({ error: "Company name is required" }, { status: 400 });
        update.company_name = company; changed.push("company");
      }
      const textMap: [string, string, number][] = [
        ["contactName", "contact_name", 160], ["phone", "phone", 60], ["email", "email", 200],
        ["specialty", "specialty", 160], ["notes", "notes", 3000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("vendors").update(update).eq("id", vendor.id);
      if (error) throw error;
      await writeHistory(admin, me, vendor.id, null, "vendor_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_vendor_status") {
      const vendor = await getVendorOr404(admin, Number(body.id || 0));
      if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
      const target = String(body.status || "");
      if (target !== "active" && target !== "archived") {
        return NextResponse.json({ error: "Choose a valid vendor status" }, { status: 400 });
      }
      if (target === vendor.status) return NextResponse.json({ ok: true });
      const { error } = await admin.from("vendors")
        .update({ status: target, updated_at: now }).eq("id", vendor.id);
      if (error) throw error;
      await writeHistory(admin, me, vendor.id, null,
        target === "archived" ? "vendor_archived" : "vendor_reactivated", { from: vendor.status, to: target });
      return NextResponse.json({ ok: true });
    }

    /* ---------------- Jobs ---------------- */

    if (action === "create_job") {
      const vendor = await getVendorOr404(admin, Number(body.vendorId || 0));
      if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
      const kind = String(body.kind || "") as VendorJobKind;
      if (!VENDOR_JOB_KINDS.includes(kind)) {
        return NextResponse.json({ error: "Choose a valid job type" }, { status: 400 });
      }
      const title = textField(body.title, 300);
      if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
      const scheduledDate = parseDateField(body.scheduledDate);
      const nextActionDate = parseDateField(body.nextActionDate);
      if (scheduledDate === "INVALID" || nextActionDate === "INVALID") {
        return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
      }
      const responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
      if (!(await requireAssignableMember(admin, responsibleMemberId))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      const assetId = body.relatedAssetId ? Number(body.relatedAssetId) : null;
      if (assetId) {
        const { data: asset } = await admin.from("assets").select("id").eq("id", assetId).maybeSingle();
        if (!asset) return NextResponse.json({ error: "Related asset not found" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("vendor_jobs").insert({
        vendor_id: vendor.id,
        kind,
        title,
        description: textField(body.description, 4000),
        status: "open",
        scheduled_date: scheduledDate,
        related_location: textField(body.relatedLocation, 200),
        asset_id: assetId,
        equipment_text: textField(body.equipmentText, 160),
        responsible_member_id: responsibleMemberId,
        next_action: textField(body.nextAction, 1000),
        next_action_date: nextActionDate,
        work_order_id: body.relatedWorkOrderId ? Number(body.relatedWorkOrderId) : null,
        log_event_id: body.relatedLogEventId ? Number(body.relatedLogEventId) : null,
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeHistory(admin, me, vendor.id, created.id, "job_created", { kind, title });
      return NextResponse.json({ jobId: created.id });
    }

    if (action === "update_job") {
      const job = await getJobOr404(admin, Number(body.id || body.jobId || 0));
      if (!job) return NextResponse.json({ error: "Vendor job not found" }, { status: 404 });
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.title !== undefined) {
        const title = textField(body.title, 300);
        if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        update.title = title; changed.push("title");
      }
      if (body.kind !== undefined) {
        const kind = String(body.kind || "") as VendorJobKind;
        if (!VENDOR_JOB_KINDS.includes(kind)) {
          return NextResponse.json({ error: "Choose a valid job type" }, { status: 400 });
        }
        update.kind = kind; changed.push("kind");
      }
      const textMap: [string, string, number][] = [
        ["description", "description", 4000], ["relatedLocation", "related_location", 200],
        ["equipmentText", "equipment_text", 160], ["nextAction", "next_action", 1000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      for (const [input, column] of [["scheduledDate", "scheduled_date"], ["nextActionDate", "next_action_date"]] as const) {
        if (body[input] !== undefined) {
          const parsed = parseDateField(body[input]);
          if (parsed === "INVALID") {
            return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
          }
          update[column] = parsed; changed.push(input);
        }
      }
      if (body.responsibleMemberId !== undefined) {
        const responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
        if (!(await requireAssignableMember(admin, responsibleMemberId))) {
          return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
        }
        update.responsible_member_id = responsibleMemberId; changed.push("responsibleMemberId");
      }
      if (body.relatedAssetId !== undefined) {
        update.asset_id = body.relatedAssetId ? Number(body.relatedAssetId) : null;
        changed.push("relatedAssetId");
      }
      if (body.relatedWorkOrderId !== undefined) {
        update.work_order_id = body.relatedWorkOrderId ? Number(body.relatedWorkOrderId) : null;
        changed.push("relatedWorkOrderId");
      }
      if (body.relatedLogEventId !== undefined) {
        update.log_event_id = body.relatedLogEventId ? Number(body.relatedLogEventId) : null;
        changed.push("relatedLogEventId");
      }
      if (body.vendorId !== undefined) {
        const vendor = await getVendorOr404(admin, Number(body.vendorId || 0));
        if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
        update.vendor_id = vendor.id; changed.push("vendorId");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("vendor_jobs").update(update).eq("id", job.id);
      if (error) throw error;
      await writeHistory(admin, me, (update.vendor_id as number) || job.vendor_id, job.id, "job_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_job_status") {
      const job = await getJobOr404(admin, Number(body.id || body.jobId || 0));
      if (!job) return NextResponse.json({ error: "Vendor job not found" }, { status: 404 });
      const target = String(body.status || "") as VendorJobStatus;
      if (!VENDOR_JOB_STATUSES.includes(target)) {
        return NextResponse.json({ error: "Choose a valid job status" }, { status: 400 });
      }
      // Completion goes through the pure rule; verification has its own action.
      if (target === "completed") {
        if (!canCompleteVendorJob(me, { status: job.status as VendorJobStatus })) {
          return NextResponse.json({
            error: `A ${job.status} job cannot be completed`,
          }, { status: 400 });
        }
        const evidenceNotes = textField(body.evidenceNotes, 4000);
        const { error } = await admin.from("vendor_jobs").update({
          status: "completed", completed_at: now, completed_by_member_id: me.id, updated_at: now,
        }).eq("id", job.id);
        if (error) throw error;
        await writeHistory(admin, me, job.vendor_id, job.id, "job_completed", {
          from: job.status, evidenceNotes,
        });
        return NextResponse.json({ ok: true });
      }
      if (target === "verified") {
        return NextResponse.json({
          error: "Use the verify action so the verifier is recorded",
        }, { status: 400 });
      }
      if (!(WORKING_TRANSITIONS[job.status] || []).includes(target)) {
        return NextResponse.json({
          error: `A ${job.status} job cannot become ${target}`,
        }, { status: 400 });
      }
      const { error } = await admin.from("vendor_jobs")
        .update({ status: target, updated_at: now }).eq("id", job.id);
      if (error) throw error;
      await writeHistory(admin, me, job.vendor_id, job.id, "job_status_changed", {
        from: job.status, to: target,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "verify_job") {
      const job = await getJobOr404(admin, Number(body.id || body.jobId || 0));
      if (!job) return NextResponse.json({ error: "Vendor job not found" }, { status: 404 });
      if (!canVerifyVendorJob(me, {
        status: job.status as VendorJobStatus,
        verified_by_member_id: job.verified_by_member_id,
      })) {
        return NextResponse.json({
          error: "Only a completed job can be verified, and only once",
        }, { status: 400 });
      }
      const { error } = await admin.from("vendor_jobs").update({
        status: "verified", verified_at: now, verified_by_member_id: me.id, updated_at: now,
      }).eq("id", job.id);
      if (error) throw error;
      await writeHistory(admin, me, job.vendor_id, job.id, "job_verified", {});
      return NextResponse.json({ ok: true, verified: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
