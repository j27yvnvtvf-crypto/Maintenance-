import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved } from "@/lib/access";
import { appTimeZone, localDate } from "@/lib/time";
import { HOLD_STATUSES, isHoldStatus, sortJobsForToday } from "@/lib/jobs-rules";

/**
 * Daily operations summary (Phase 5 — Centro de Operaciones).
 *
 * GET only, approved accounts only (access model v2, re-checked per
 * request). Every KPI is computed HERE from the real tables at read
 * time — nothing is stored, so nothing goes stale:
 * - scheduledToday: jobs whose scheduled_date is today, not completed.
 * - active: jobs not completed.
 * - overdue: due_date before today, not completed.
 * - blocked: jobs in any hold status (lib/jobs-rules HOLD_STATUSES).
 * - pendingInspections: inspections scheduled or in progress.
 * - upcomingVisits: vendor visits still 'scheduled' in the next 7 days
 *   (count + the next 5).
 * - lowStock: active inventory items at or below their minimum.
 * - complianceAlerts: vendor visits whose compliance is to_verify or
 *   expired and whose compliance due date is within the next 7 days
 *   (overdue ones included).
 * ?scope=mine narrows the JOB-based figures (and the priority list) to
 * jobs assigned to me or where I collaborate; inspections, visits and
 * inventory are property-wide either way.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type JobRow = {
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
};

type VisitRow = {
  id: number; vendor_id: number; service: string | null;
  visit_date: string | null; visit_time: string | null;
  building: string | null; unit: string | null;
  status: string; confirmation_status: string;
  compliance_status: string; compliance_due_date: string | null;
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

/** Same client shape as jobForClient in app/api/dashboard/route.ts. */
function jobForClient(
  job: JobRow,
  names: Map<number, string>,
  vendorNames: Map<number, string>,
  collaborators: Map<number, number[]>,
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

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const me = await getCurrentMember();
    if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");
    const admin: AdminClient = createAdminClient();
    const today = localDate(new Date());
    const in7Days = addDays(today, 7);
    const scopeMine = req.nextUrl.searchParams.get("scope") === "mine";

    const [
      { data: jobRows, error: jobError },
      { data: memberRows, error: memberError },
      { data: vendorRows, error: vendorError },
      { data: collabRows, error: collabError },
      { data: inspectionRows, error: inspectionError },
      { data: visitRows, error: visitError },
      { data: itemRows, error: itemError },
    ] = await Promise.all([
      admin.from("work_orders").select("*").order("created_at", { ascending: false }).limit(1000),
      admin.from("members").select("id, name"),
      admin.from("vendors").select("id, company_name"),
      admin.from("work_order_collaborators").select("work_order_id, member_id"),
      admin.from("inspections").select("id, status").in("status", ["scheduled", "in_progress"]).limit(1000),
      admin.from("vendor_visits").select("*").order("visit_date", { ascending: true }).limit(1000),
      admin.from("inventory_items").select("id, name, quantity_on_hand, min_quantity")
        .eq("status", "active").limit(1000),
    ]);
    if (jobError) throw jobError;
    if (memberError) throw memberError;
    if (vendorError) throw vendorError;
    if (collabError) throw collabError;
    if (inspectionError) throw inspectionError;
    if (visitError) throw visitError;
    if (itemError) throw itemError;

    const names = new Map(
      ((memberRows || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]),
    );
    const vendorNames = new Map(
      ((vendorRows || []) as { id: number; company_name: string }[]).map((v) => [v.id, v.company_name]),
    );
    const collaborators = new Map<number, number[]>();
    const myJobIds = new Set<number>();
    for (const row of (collabRows || []) as { work_order_id: number; member_id: number }[]) {
      collaborators.set(row.work_order_id, [...(collaborators.get(row.work_order_id) || []), row.member_id]);
      if (row.member_id === me.id) myJobIds.add(row.work_order_id);
    }

    let jobs = ((jobRows || []) as JobRow[])
      .map((job) => jobForClient(job, names, vendorNames, collaborators));
    if (scopeMine) {
      jobs = jobs.filter((job) => job.assignedTo === me.id || myJobIds.has(job.id));
    }
    const activeJobs = jobs.filter((job) => job.status !== "completed");
    const visits = (visitRows || []) as VisitRow[];
    const upcoming = visits.filter(
      (visit) => visit.status === "scheduled" && visit.visit_date
        && visit.visit_date >= today && visit.visit_date <= in7Days,
    );
    const complianceDue = visits.filter(
      (visit) => (visit.compliance_status === "to_verify" || visit.compliance_status === "expired")
        && visit.compliance_due_date && visit.compliance_due_date <= in7Days,
    );
    type ItemLite = { id: number; name: string; quantity_on_hand: number | string; min_quantity: number | string };
    const lowStockItems = ((itemRows || []) as ItemLite[])
      .filter((item) => Number(item.quantity_on_hand) <= Number(item.min_quantity));
    const overdueFollowUps = activeJobs.filter(
      (job) => isHoldStatus(job.status) && job.holdFollowUpDate && job.holdFollowUpDate <= today,
    );

    const alerts: { kind: string; text: string; count: number }[] = [];
    if (overdueFollowUps.length) {
      alerts.push({
        kind: "overdue_followups",
        text: `${overdueFollowUps.length} seguimiento(s) de espera vencido(s): `
          + overdueFollowUps.slice(0, 5).map((job) => `#${job.id} ${job.title}`).join("; "),
        count: overdueFollowUps.length,
      });
    }
    if (lowStockItems.length) {
      alerts.push({
        kind: "low_stock",
        text: `Bajo stock: ${lowStockItems.map((item) => item.name).join(", ")}`,
        count: lowStockItems.length,
      });
    }
    if (complianceDue.length) {
      alerts.push({
        kind: "compliance_due",
        text: `${complianceDue.length} cumplimiento(s) de vendor por verificar o vencidos (vencen en 7 días o antes).`,
        count: complianceDue.length,
      });
    }

    return NextResponse.json({
      date: today,
      timeZone: appTimeZone(),
      kpis: {
        scheduledToday: activeJobs.filter((job) => job.scheduledDate === today).length,
        active: activeJobs.length,
        overdue: activeJobs.filter((job) => job.dueDate && job.dueDate < today).length,
        blocked: activeJobs.filter((job) => (HOLD_STATUSES as string[]).includes(job.status)).length,
        pendingInspections: (inspectionRows || []).length,
        upcomingVisits: upcoming.length,
        lowStock: lowStockItems.length,
        complianceAlerts: complianceDue.length,
      },
      upcomingVisits: upcoming.slice(0, 5).map((visit) => ({
        id: visit.id,
        vendorId: visit.vendor_id,
        vendorName: vendorNames.get(visit.vendor_id) || null,
        service: visit.service,
        visitDate: visit.visit_date,
        visitTime: visit.visit_time,
        building: visit.building,
        unit: visit.unit,
        status: visit.status,
        confirmationStatus: visit.confirmation_status,
      })),
      priorityJobs: sortJobsForToday(activeJobs, today).slice(0, 10),
      alerts,
    });
  } catch (error) {
    return failure(error);
  }
}
