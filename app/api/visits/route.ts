import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved, type MemberRow } from "@/lib/access";

/**
 * Vendor visits API (Phase 5 — Centro de Operaciones, spec §7).
 *
 * A visit is a record of its own (vendor_visits), linked optionally to
 * a vendor job and a work order. GOLDEN RULE: completing a visit NEVER
 * touches the linked work order — there is deliberately no code path
 * from this route to work_orders. Every mutation joins the append-only
 * vendor_history trail with the visit_* actions. Approved accounts
 * only (access model v2, re-checked per request); nothing is deleted.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const CONFIRMATION_STATUSES = ["pending", "confirmed", "rescheduled", "cancelled"];
const VISIT_STATUSES = ["scheduled", "completed_visit", "cancelled", "no_show"];
const COMPLIANCE_STATUSES = ["to_verify", "verified", "expired", "documented_exception"];

type VisitRow = {
  id: number; vendor_id: number; vendor_job_id: number | null;
  work_order_id: number | null; service: string | null;
  visit_date: string | null; visit_time: string | null;
  building: string | null; unit: string | null;
  responsible_member_id: number | null;
  confirmation_status: string; status: string;
  scope: string | null; access_requirements: string | null;
  result: string | null; pending_notes: string | null;
  quoted_amount: number | string | null; po_number: string | null;
  gl_code: string | null; actual_cost: number | string | null;
  compliance_status: string; compliance_due_date: string | null;
  netvendor_ref: string | null; compliance_note: string | null;
  created_at: string; updated_at: string;
};

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

async function requireApproved(): Promise<MemberRow> {
  const me = await getCurrentMember();
  if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
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

function amountField(value: unknown): number | null | "INVALID" {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "INVALID";
  return amount;
}

async function writeVisitHistory(
  admin: AdminClient,
  actor: MemberRow,
  visit: VisitRow,
  action: string,
  detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("vendor_history").insert({
    vendor_id: visit.vendor_id,
    vendor_job_id: visit.vendor_job_id,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail: { visitId: visit.id, ...detail },
  });
  if (error) throw error;
}

function visitForClient(
  visit: VisitRow,
  names: Map<number, string>,
  vendorNames: Map<number, string>,
) {
  return {
    id: visit.id,
    vendorId: visit.vendor_id,
    vendorName: vendorNames.get(visit.vendor_id) || null,
    vendorJobId: visit.vendor_job_id,
    workOrderId: visit.work_order_id,
    service: visit.service,
    visitDate: visit.visit_date,
    visitTime: visit.visit_time,
    building: visit.building,
    unit: visit.unit,
    responsibleMemberId: visit.responsible_member_id,
    responsibleName: visit.responsible_member_id
      ? names.get(visit.responsible_member_id) || null : null,
    confirmationStatus: visit.confirmation_status,
    status: visit.status,
    scope: visit.scope,
    accessRequirements: visit.access_requirements,
    result: visit.result,
    pendingNotes: visit.pending_notes,
    quotedAmount: visit.quoted_amount != null ? Number(visit.quoted_amount) : null,
    poNumber: visit.po_number,
    glCode: visit.gl_code,
    actualCost: visit.actual_cost != null ? Number(visit.actual_cost) : null,
    complianceStatus: visit.compliance_status,
    complianceDueDate: visit.compliance_due_date,
    netvendorRef: visit.netvendor_ref,
    complianceNote: visit.compliance_note,
    createdAt: visit.created_at,
    updatedAt: visit.updated_at,
  };
}

async function getVisitOr404(admin: AdminClient, id: number): Promise<VisitRow | null> {
  if (!id) return null;
  const { data, error } = await admin
    .from("vendor_visits").select("*").eq("id", id).maybeSingle<VisitRow>();
  if (error) throw error;
  return data;
}

/** Parses the shared visit fields from a request body. */
function parseVisitFields(
  body: Record<string, unknown>,
): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};
  const textMap: [string, string, number][] = [
    ["service", "service", 300], ["visitTime", "visit_time", 40],
    ["building", "building", 120], ["unit", "unit", 60],
    ["scope", "scope", 4000], ["accessRequirements", "access_requirements", 2000],
    ["result", "result", 4000], ["pendingNotes", "pending_notes", 4000],
    ["poNumber", "po_number", 120], ["glCode", "gl_code", 120],
    ["netvendorRef", "netvendor_ref", 200], ["complianceNote", "compliance_note", 2000],
  ];
  for (const [input, column, max] of textMap) {
    if (body[input] !== undefined) fields[column] = textField(body[input], max);
  }
  for (const [input, column] of [
    ["visitDate", "visit_date"], ["complianceDueDate", "compliance_due_date"],
  ] as const) {
    if (body[input] !== undefined) {
      const parsed = dateField(body[input]);
      if (parsed === "INVALID") return { fields, error: "Dates must use YYYY-MM-DD format" };
      fields[column] = parsed;
    }
  }
  for (const [input, column] of [
    ["quotedAmount", "quoted_amount"], ["actualCost", "actual_cost"],
  ] as const) {
    if (body[input] !== undefined) {
      const parsed = amountField(body[input]);
      if (parsed === "INVALID") return { fields, error: "Amounts must be numbers of 0 or more" };
      fields[column] = parsed;
    }
  }
  if (body.responsibleMemberId !== undefined) {
    fields.responsible_member_id = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
  }
  if (body.vendorJobId !== undefined) {
    fields.vendor_job_id = body.vendorJobId ? Number(body.vendorJobId) : null;
  }
  if (body.workOrderId !== undefined) {
    fields.work_order_id = body.workOrderId ? Number(body.workOrderId) : null;
  }
  if (body.confirmationStatus !== undefined) {
    if (!CONFIRMATION_STATUSES.includes(String(body.confirmationStatus))) {
      return { fields, error: "Choose a valid confirmation status" };
    }
    fields.confirmation_status = String(body.confirmationStatus);
  }
  if (body.status !== undefined) {
    if (!VISIT_STATUSES.includes(String(body.status))) {
      return { fields, error: "Choose a valid visit status" };
    }
    fields.status = String(body.status);
  }
  if (body.complianceStatus !== undefined) {
    if (!COMPLIANCE_STATUSES.includes(String(body.complianceStatus))) {
      return { fields, error: "Choose a valid compliance status" };
    }
    fields.compliance_status = String(body.complianceStatus);
  }
  return { fields };
}

export async function GET(req: NextRequest) {
  try {
    await requireApproved();
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;
    let query = admin.from("vendor_visits").select("*")
      .order("visit_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    const from = params.get("from");
    const to = params.get("to");
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("visit_date", from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("visit_date", to);
    if (params.get("vendorId") && Number(params.get("vendorId"))) {
      query = query.eq("vendor_id", Number(params.get("vendorId")));
    }
    if (params.get("building")) query = query.eq("building", params.get("building"));
    if (params.get("unit")) query = query.eq("unit", params.get("unit"));
    if (params.get("workOrderId") && Number(params.get("workOrderId"))) {
      query = query.eq("work_order_id", Number(params.get("workOrderId")));
    }
    if (params.get("status") && VISIT_STATUSES.includes(String(params.get("status")))) {
      query = query.eq("status", String(params.get("status")));
    }
    const { data, error } = await query;
    if (error) throw error;
    const visits = (data || []) as VisitRow[];
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
    return NextResponse.json({
      visits: visits.map((visit) => visitForClient(visit, names, vendorNames)),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireApproved();
    const admin = createAdminClient();
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || "");
    const now = new Date().toISOString();

    if (action === "create") {
      const vendorId = Number(body.vendorId || 0);
      if (!vendorId) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });
      const { data: vendor, error: vendorError } = await admin
        .from("vendors").select("id").eq("id", vendorId).maybeSingle();
      if (vendorError) throw vendorError;
      if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
      const { fields, error: parseError } = parseVisitFields(body);
      if (parseError) return NextResponse.json({ error: parseError }, { status: 400 });
      const { data: created, error } = await admin.from("vendor_visits").insert({
        vendor_id: vendorId,
        confirmation_status: "pending",
        status: "scheduled",
        compliance_status: "to_verify",
        ...fields,
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("*").single<VisitRow>();
      if (error) throw error;
      await writeVisitHistory(admin, me, created, "visit_created", {
        vendorId, service: created.service, visitDate: created.visit_date,
        workOrderId: created.work_order_id,
      });
      return NextResponse.json({ visitId: created.id });
    }

    const visit = await getVisitOr404(admin, Number(body.id || body.visitId || 0));
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    if (action === "update") {
      const { fields, error: parseError } = parseVisitFields(body);
      if (parseError) return NextResponse.json({ error: parseError }, { status: 400 });
      const changed = Object.keys(fields);
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("vendor_visits")
        .update({ ...fields, updated_at: now }).eq("id", visit.id);
      if (error) throw error;
      await writeVisitHistory(admin, me, visit, "visit_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "confirm") {
      const { error } = await admin.from("vendor_visits")
        .update({ confirmation_status: "confirmed", updated_at: now }).eq("id", visit.id);
      if (error) throw error;
      await writeVisitHistory(admin, me, visit, "visit_updated", {
        confirmationStatus: { from: visit.confirmation_status, to: "confirmed" },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reschedule") {
      const visitDate = dateField(body.visitDate);
      if (visitDate === "INVALID" || !visitDate) {
        return NextResponse.json({ error: "A new visit date (YYYY-MM-DD) is required" }, { status: 400 });
      }
      const visitTime = body.visitTime !== undefined
        ? textField(body.visitTime, 40) : visit.visit_time;
      const { error } = await admin.from("vendor_visits").update({
        visit_date: visitDate, visit_time: visitTime,
        confirmation_status: "rescheduled", updated_at: now,
      }).eq("id", visit.id);
      if (error) throw error;
      await writeVisitHistory(admin, me, visit, "visit_rescheduled", {
        from: { visitDate: visit.visit_date, visitTime: visit.visit_time },
        to: { visitDate, visitTime },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "complete_visit") {
      // The visit outcome is recorded on the VISIT only. The linked work
      // order is not read, not updated, not completed — by design.
      const update: Record<string, unknown> = { status: "completed_visit", updated_at: now };
      if (body.result !== undefined) update.result = textField(body.result, 4000);
      if (body.pendingNotes !== undefined) update.pending_notes = textField(body.pendingNotes, 4000);
      const { error } = await admin.from("vendor_visits").update(update).eq("id", visit.id);
      if (error) throw error;
      await writeVisitHistory(admin, me, visit, "visit_completed", {
        result: (update.result as string | null) ?? visit.result,
        workOrderId: visit.work_order_id,
        workOrderTouched: false,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel") {
      const { error } = await admin.from("vendor_visits").update({
        status: "cancelled", confirmation_status: "cancelled", updated_at: now,
      }).eq("id", visit.id);
      if (error) throw error;
      await writeVisitHistory(admin, me, visit, "visit_cancelled", {
        from: visit.status,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
