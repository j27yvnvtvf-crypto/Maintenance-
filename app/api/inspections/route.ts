import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, type MemberRow } from "@/lib/access";
import { localDate } from "@/lib/time";
import {
  canAccessInspections,
  canAttachInspectionFile,
  canCompleteCorrectiveAction,
  canCompleteInspection,
  canCreateCorrectiveAction,
  canExecuteInspection,
  canManageTemplates,
  canRecordResult,
  canReopenInspection,
  canStartFromTemplate,
  canUpdateCorrectiveAction,
  canVerifyCorrectiveAction,
  canViewTemplate,
  isCorrectiveOverdue,
  isInspectionOverdue,
  FREQUENCY_TYPES,
  INSPECTION_STATUSES,
  ITEM_RESPONSE_TYPES,
  ITEM_RESULT_STATUSES,
  TEMPLATE_STATUSES,
  TEMPLATE_TYPES,
  type CorrectiveStatus,
  type FrequencyType,
  type InspectionStatus,
  type ItemAnswer,
  type ItemResponseType,
  type ItemResultStatus,
  type TemplateStatus,
  type TemplateType,
} from "@/lib/inspections-rules";

/**
 * Inspections & preventive maintenance API (Phase 3A).
 *
 * Every permission decision is made HERE, on the server, per request,
 * from the database state — the UI only mirrors them:
 * - Unapproved accounts get 403 on everything.
 * - Every approved account has the SAME operational permissions:
 *   create and execute inspections, record results and photos,
 *   generate corrective actions from findings, follow them up,
 *   complete them and verify their closure. Execute the daily shop
 *   closing record too (it is an inspection of type 'shop_closing').
 * - TEMPLATES are system configuration: only the administrator
 *   (is_admin) creates, edits, publishes or archives them, and every
 *   one of those acts joins the Phase 0 admin_audit_log.
 * - Nothing operational is ever deleted through this API: templates
 *   are archived, inspections are completed/reopened, results are
 *   snapshots that lock when the inspection completes, and the
 *   history is append-only — written only by this server code, in the
 *   same request as the change it records.
 * - Files live in the private "inspections" Storage bucket. Bytes are
 *   never served by this route; downloads go through the signed-URL
 *   route after the same checks (app/api/inspections/download).
 */

const BUCKET = "inspections";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md",
]);
const LIST_LIMIT = 300;
const MAX_TEMPLATE_ITEMS = 100;

type TemplateRow = {
  id: number; name: string; template_type: TemplateType;
  area_label: string | null; description: string | null;
  frequency_type: FrequencyType; frequency_note: string | null;
  status: TemplateStatus; created_at: string; updated_at: string;
};

type TemplateItemRow = {
  id: number; template_id: number; position: number; prompt: string;
  response_type: ItemResponseType; allows_photo: boolean; required: boolean;
};

type InspectionRow = {
  id: number; folio: string; template_id: number | null;
  template_name: string | null; template_type: TemplateType;
  frequency_type: string | null; frequency_note: string | null;
  title: string; building: string | null; unit: string | null;
  area: string | null; equipment: string | null;
  assigned_member_id: number | null; scheduled_date: string | null;
  status: InspectionStatus; general_notes: string | null;
  signature_name: string | null;
  created_by_member_id: number | null; started_at: string | null;
  completed_by_member_id: number | null; completed_at: string | null;
  created_at: string; updated_at: string;
};

type ResultRow = {
  id: number; inspection_id: number; template_item_id: number | null;
  position: number; prompt: string; response_type: ItemResponseType;
  allows_photo: boolean; required: boolean;
  status: ItemResultStatus | null; answer: ItemAnswer | null;
  note: string | null; answered_by_member_id: number | null;
  answered_at: string | null;
};

type CorrectiveRow = {
  id: number; inspection_id: number; result_id: number;
  description: string; responsible_member_id: number | null;
  due_date: string | null; status: CorrectiveStatus;
  work_order_id: number | null; log_event_id: number | null;
  created_by_member_id: number | null;
  completed_by_member_id: number | null; completed_at: string | null;
  verified_by_member_id: number | null; verified_at: string | null;
  created_at: string; updated_at: string;
};

type HistoryRow = {
  id: number; inspection_id: number; corrective_action_id: number | null;
  actor_member_id: number | null; actor_email: string; action: string;
  detail: Record<string, unknown>; created_at: string;
};

type AttachmentRow = {
  id: number; inspection_id: number; result_id: number | null;
  corrective_action_id: number | null; file_name: string;
  content_type: string | null; file_size: number | null;
  uploaded_by_member_id: number | null; created_at: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

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

async function requireOperationalMember() {
  const me = await getCurrentMember();
  // Per-request state check: a suspended account with an open session is
  // stopped here, exactly like every other data endpoint.
  if (!canAccessInspections(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

async function memberNames(admin: AdminClient) {
  const { data, error } = await admin.from("members").select("id, name");
  if (error) throw error;
  return new Map(((data || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
}

async function getTemplateOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("inspection_templates").select("*").eq("id", id).maybeSingle<TemplateRow>();
  if (error) throw error;
  return data;
}

async function getInspectionOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("inspections").select("*").eq("id", id).maybeSingle<InspectionRow>();
  if (error) throw error;
  return data;
}

async function getResultOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("inspection_results").select("*").eq("id", id).maybeSingle<ResultRow>();
  if (error) throw error;
  return data;
}

async function getCorrectiveOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("corrective_actions").select("*").eq("id", id).maybeSingle<CorrectiveRow>();
  if (error) throw error;
  return data;
}

/** Append-only history: the ONLY write this module ever makes to it. */
async function writeHistory(
  admin: AdminClient,
  actor: MemberRow,
  inspectionId: number,
  action: HistoryRow["action"],
  detail: Record<string, unknown> = {},
  correctiveActionId: number | null = null,
) {
  const { error } = await admin.from("inspection_history").insert({
    inspection_id: inspectionId,
    corrective_action_id: correctiveActionId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

/** Template administration joins the Phase 0 administrative audit trail. */
async function writeTemplateAudit(
  admin: AdminClient,
  actor: MemberRow,
  action: "create_inspection_template" | "update_inspection_template" | "publish_inspection_template" | "archive_inspection_template",
  template: TemplateRow,
  detail: Record<string, unknown>,
) {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_user_id: actor.user_id,
    actor_member_id: actor.id,
    actor_email: actor.email,
    action,
    target_member_id: null,
    target_email: null,
    detail: { templateId: template.id, name: template.name, ...detail },
  });
  if (error) throw error;
}

function templateForClient(template: TemplateRow, items: TemplateItemRow[]) {
  return {
    id: template.id,
    name: template.name,
    templateType: template.template_type,
    areaLabel: template.area_label,
    description: template.description,
    frequencyType: template.frequency_type,
    frequencyNote: template.frequency_note,
    status: template.status,
    items: items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        position: item.position,
        prompt: item.prompt,
        responseType: item.response_type,
        allowsPhoto: item.allows_photo,
        required: item.required,
      })),
    createdAt: template.created_at,
    updatedAt: template.updated_at,
  };
}

function inspectionForClient(
  inspection: InspectionRow,
  names: Map<number, string>,
  today: string,
  progress?: { answered: number; total: number; findings: number; openActions: number },
) {
  const name = (id: number | null) => (id ? names.get(id) || null : null);
  return {
    id: inspection.id,
    folio: inspection.folio,
    templateId: inspection.template_id,
    templateName: inspection.template_name,
    templateType: inspection.template_type,
    frequencyType: inspection.frequency_type,
    frequencyNote: inspection.frequency_note,
    title: inspection.title,
    building: inspection.building,
    unit: inspection.unit,
    area: inspection.area,
    equipment: inspection.equipment,
    location: [inspection.building, inspection.unit, inspection.area, inspection.equipment]
      .map((part) => (part || "").trim()).filter(Boolean).join(" · "),
    assignedMemberId: inspection.assigned_member_id,
    assignedName: name(inspection.assigned_member_id),
    scheduledDate: inspection.scheduled_date,
    status: inspection.status,
    generalNotes: inspection.general_notes,
    signatureName: inspection.signature_name,
    createdByMemberId: inspection.created_by_member_id,
    createdByName: name(inspection.created_by_member_id),
    startedAt: inspection.started_at,
    completedByMemberId: inspection.completed_by_member_id,
    completedByName: name(inspection.completed_by_member_id),
    completedAt: inspection.completed_at,
    createdAt: inspection.created_at,
    updatedAt: inspection.updated_at,
    overdue: isInspectionOverdue(inspection, today),
    answered: progress?.answered ?? null,
    totalItems: progress?.total ?? null,
    findings: progress?.findings ?? null,
    openActions: progress?.openActions ?? null,
  };
}

function resultForClient(result: ResultRow, names: Map<number, string>) {
  return {
    id: result.id,
    position: result.position,
    prompt: result.prompt,
    responseType: result.response_type,
    allowsPhoto: result.allows_photo,
    required: result.required,
    status: result.status,
    answer: result.answer,
    note: result.note,
    answeredByMemberId: result.answered_by_member_id,
    answeredByName: result.answered_by_member_id ? names.get(result.answered_by_member_id) || null : null,
    answeredAt: result.answered_at,
  };
}

function correctiveForClient(
  action: CorrectiveRow,
  names: Map<number, string>,
  today: string,
  extras?: { resultPrompt?: string | null; workOrderLabel?: string | null; logEventFolio?: string | null },
) {
  const name = (id: number | null) => (id ? names.get(id) || null : null);
  return {
    id: action.id,
    inspectionId: action.inspection_id,
    resultId: action.result_id,
    resultPrompt: extras?.resultPrompt ?? null,
    description: action.description,
    responsibleMemberId: action.responsible_member_id,
    responsibleName: name(action.responsible_member_id),
    dueDate: action.due_date,
    status: action.status,
    workOrderId: action.work_order_id,
    workOrderLabel: extras?.workOrderLabel ?? null,
    logEventId: action.log_event_id,
    logEventFolio: extras?.logEventFolio ?? null,
    createdByMemberId: action.created_by_member_id,
    createdByName: name(action.created_by_member_id),
    completedByMemberId: action.completed_by_member_id,
    completedByName: name(action.completed_by_member_id),
    completedAt: action.completed_at,
    verifiedByMemberId: action.verified_by_member_id,
    verifiedByName: name(action.verified_by_member_id),
    verifiedAt: action.verified_at,
    overdue: isCorrectiveOverdue(action, today),
    createdAt: action.created_at,
    updatedAt: action.updated_at,
  };
}

function attachmentForClient(file: AttachmentRow, names: Map<number, string>) {
  return {
    id: file.id,
    inspectionId: file.inspection_id,
    resultId: file.result_id,
    correctiveActionId: file.corrective_action_id,
    fileName: file.file_name,
    contentType: file.content_type,
    fileSize: file.file_size,
    uploadedByMemberId: file.uploaded_by_member_id,
    uploadedByName: file.uploaded_by_member_id ? names.get(file.uploaded_by_member_id) || null : null,
    createdAt: file.created_at,
  };
}

async function progressFor(admin: AdminClient, inspectionIds: number[]) {
  const progress = new Map<number, { answered: number; total: number; findings: number; openActions: number }>();
  if (!inspectionIds.length) return progress;
  const [{ data: resultRows, error: rErr }, { data: actionRows, error: aErr }] = await Promise.all([
    admin.from("inspection_results").select("inspection_id, required, status").in("inspection_id", inspectionIds),
    admin.from("corrective_actions").select("inspection_id, status").in("inspection_id", inspectionIds),
  ]);
  if (rErr) throw rErr;
  if (aErr) throw aErr;
  for (const id of inspectionIds) progress.set(id, { answered: 0, total: 0, findings: 0, openActions: 0 });
  for (const row of (resultRows || []) as { inspection_id: number; status: ItemResultStatus | null }[]) {
    const entry = progress.get(row.inspection_id);
    if (!entry) continue;
    entry.total += 1;
    if (row.status != null) entry.answered += 1;
    if (row.status === "pending" || row.status === "in_progress" || row.status === "waiting_vendor") entry.findings += 1;
  }
  for (const row of (actionRows || []) as { inspection_id: number; status: CorrectiveStatus }[]) {
    const entry = progress.get(row.inspection_id);
    if (!entry) continue;
    if (row.status === "open" || row.status === "in_progress") entry.openActions += 1;
  }
  return progress;
}

export async function GET(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const today = localDate(new Date());
    const names = await memberNames(admin);
    const params = req.nextUrl.searchParams;

    // --- Summary for the Hoy / Today attention card ---
    if (params.get("summary")) {
      const [{ data: inspRows, error: inspError }, { data: actionRows, error: actionError }] = await Promise.all([
        admin.from("inspections").select("*").neq("status", "completed")
          .order("scheduled_date", { ascending: true, nullsFirst: false }).limit(1000),
        admin.from("corrective_actions").select("*")
          .in("status", ["open", "in_progress"])
          .order("due_date", { ascending: true, nullsFirst: false }).limit(1000),
      ]);
      if (inspError) throw inspError;
      if (actionError) throw actionError;
      const openInspections = (inspRows || []) as InspectionRow[];
      const openActions = (actionRows || []) as CorrectiveRow[];
      const overdueInspections = openInspections
        .filter((row) => isInspectionOverdue(row, today))
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
      const overdueActions = openActions
        .filter((row) => isCorrectiveOverdue(row, today))
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
      const inspIds = [...new Set(overdueActions.map((row) => row.inspection_id))];
      const folioById = new Map<number, string>();
      if (inspIds.length) {
        const { data: folioRows, error: folioError } = await admin
          .from("inspections").select("id, folio").in("id", inspIds);
        if (folioError) throw folioError;
        for (const row of (folioRows || []) as { id: number; folio: string }[]) folioById.set(row.id, row.folio);
      }
      return NextResponse.json({
        overdueInspections: overdueInspections.length,
        dueToday: openInspections.filter((row) => row.scheduled_date === today).length,
        openCorrective: openActions.length,
        overdueCorrective: overdueActions.length,
        topInspections: overdueInspections.slice(0, 5).map((row) => inspectionForClient(row, names, today)),
        topCorrective: overdueActions.slice(0, 5).map((row) => ({
          ...correctiveForClient(row, names, today),
          inspectionFolio: folioById.get(row.inspection_id) || null,
        })),
      });
    }

    // --- Detail: one inspection with results, actions, files, history ---
    const detailId = Number(params.get("id") || 0);
    if (detailId) {
      const inspection = await getInspectionOr404(admin, detailId);
      if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

      const [{ data: resultRows, error: resultError },
        { data: actionRows, error: actionError },
        { data: attachmentRows, error: attachmentError },
        { data: historyRows, error: historyError },
        { data: readingRows, error: readingError }] = await Promise.all([
        admin.from("inspection_results").select("*").eq("inspection_id", inspection.id).order("position", { ascending: true }),
        admin.from("corrective_actions").select("*").eq("inspection_id", inspection.id).order("created_at", { ascending: true }),
        admin.from("inspection_attachments").select("*").eq("inspection_id", inspection.id).order("created_at", { ascending: true }),
        admin.from("inspection_history").select("*").eq("inspection_id", inspection.id).order("created_at", { ascending: true }).limit(500),
        admin.from("inspection_readings").select("*").eq("inspection_id", inspection.id).order("created_at", { ascending: true }).limit(500),
      ]);
      if (resultError) throw resultError;
      if (actionError) throw actionError;
      if (attachmentError) throw attachmentError;
      if (historyError) throw historyError;
      if (readingError) throw readingError;

      const results = (resultRows || []) as ResultRow[];
      const actions = (actionRows || []) as CorrectiveRow[];
      const promptByResult = new Map(results.map((row) => [row.id, row.prompt]));
      const woIds = [...new Set(actions.map((row) => row.work_order_id).filter(Boolean))] as number[];
      const logIds = [...new Set(actions.map((row) => row.log_event_id).filter(Boolean))] as number[];
      const woLabel = new Map<number, string>();
      const logFolio = new Map<number, string>();
      if (woIds.length) {
        const { data, error } = await admin.from("work_orders").select("id, title").in("id", woIds);
        if (error) throw error;
        for (const row of (data || []) as { id: number; title: string }[]) woLabel.set(row.id, `#${row.id} — ${row.title}`);
      }
      if (logIds.length) {
        const { data, error } = await admin.from("log_events").select("id, folio").in("id", logIds);
        if (error) throw error;
        for (const row of (data || []) as { id: number; folio: string }[]) logFolio.set(row.id, row.folio);
      }

      // Link options for corrective actions: existing WOs and logbook
      // events — the follow-up links to those systems, never duplicates.
      const [{ data: woOptions, error: woOptError }, { data: logOptions, error: logOptError }] = await Promise.all([
        admin.from("work_orders").select("id, title, status, area").order("created_at", { ascending: false }).limit(200),
        admin.from("log_events").select("id, folio, description, status").order("created_at", { ascending: false }).limit(200),
      ]);
      if (woOptError) throw woOptError;
      if (logOptError) throw logOptError;

      const attachments = ((attachmentRows || []) as AttachmentRow[]).map((file) => attachmentForClient(file, names));
      const progress = await progressFor(admin, [inspection.id]);

      return NextResponse.json({
        inspection: inspectionForClient(inspection, names, today, progress.get(inspection.id)),
        results: results.map((row) => ({
          ...resultForClient(row, names),
          attachments: attachments.filter((file) => file.resultId === row.id),
        })),
        correctiveActions: actions.map((row) => correctiveForClient(row, names, today, {
          resultPrompt: promptByResult.get(row.result_id) || null,
          workOrderLabel: row.work_order_id ? woLabel.get(row.work_order_id) || null : null,
          logEventFolio: row.log_event_id ? logFolio.get(row.log_event_id) || null : null,
        })),
        attachments: attachments.filter((file) => file.resultId == null && file.correctiveActionId == null),
        actionAttachments: attachments.filter((file) => file.correctiveActionId != null),
        readings: ((readingRows || []) as {
          id: number; inspection_id: number; result_id: number | null;
          label: string; value: string | null; unit: string | null;
          location: string | null; measured_at: string | null;
          recorded_by_member_id: number | null; created_at: string;
        }[]).map((row) => ({
          id: row.id,
          inspectionId: row.inspection_id,
          resultId: row.result_id,
          label: row.label,
          value: row.value,
          unit: row.unit,
          location: row.location,
          measuredAt: row.measured_at,
          recordedByMemberId: row.recorded_by_member_id,
          recordedByName: row.recorded_by_member_id ? names.get(row.recorded_by_member_id) || null : null,
          createdAt: row.created_at,
        })),
        history: ((historyRows || []) as HistoryRow[]).map((entry) => ({
          id: entry.id,
          action: entry.action,
          detail: entry.detail,
          correctiveActionId: entry.corrective_action_id,
          actorMemberId: entry.actor_member_id,
          actorName: entry.actor_member_id ? names.get(entry.actor_member_id) || null : null,
          actorEmail: entry.actor_email,
          createdAt: entry.created_at,
        })),
        linkOptions: {
          workOrders: ((woOptions || []) as { id: number; title: string; status: string; area: string }[])
            .map((row) => ({ id: row.id, label: `#${row.id} — ${row.title}`, status: row.status, area: row.area })),
          logEvents: ((logOptions || []) as { id: number; folio: string; description: string; status: string }[])
            .map((row) => ({ id: row.id, label: `${row.folio} — ${row.description.slice(0, 60)}`, folio: row.folio, status: row.status })),
        },
      });
    }

    // --- Lists: templates visible to me + inspections with filters ---
    const [{ data: templateRows, error: templateError }, { data: itemRows, error: itemError }] = await Promise.all([
      admin.from("inspection_templates").select("*").order("name", { ascending: true }),
      admin.from("inspection_template_items").select("*").order("position", { ascending: true }),
    ]);
    if (templateError) throw templateError;
    if (itemError) throw itemError;
    const itemsByTemplate = new Map<number, TemplateItemRow[]>();
    for (const item of (itemRows || []) as TemplateItemRow[]) {
      itemsByTemplate.set(item.template_id, [...(itemsByTemplate.get(item.template_id) || []), item]);
    }
    const templates = ((templateRows || []) as TemplateRow[])
      .filter((template) => canViewTemplate(me, template))
      .map((template) => templateForClient(template, itemsByTemplate.get(template.id) || []));

    let query = admin
      .from("inspections")
      .select("*")
      .order("scheduled_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    const status = params.get("status");
    const type = params.get("type");
    const assigned = params.get("assigned");
    if (status && INSPECTION_STATUSES.includes(status as InspectionStatus)) query = query.eq("status", status);
    if (type && TEMPLATE_TYPES.includes(type as TemplateType)) query = query.eq("template_type", type);
    if (assigned && Number(assigned)) query = query.eq("assigned_member_id", Number(assigned));
    const { data: inspRows, error: inspError } = await query;
    if (inspError) throw inspError;
    let inspections = (inspRows || []) as InspectionRow[];
    const q = (params.get("q") || "").trim().toLowerCase();
    if (q) {
      inspections = inspections.filter((row) =>
        [row.folio, row.title, row.template_name, row.building, row.unit, row.area, row.equipment]
          .some((field) => (field || "").toLowerCase().includes(q)));
    }
    // Today's shop closing record (one per day), for the quick action.
    const { data: shopRows, error: shopError } = await admin
      .from("inspections").select("*")
      .eq("template_type", "shop_closing").eq("scheduled_date", today)
      .order("created_at", { ascending: false }).limit(1);
    if (shopError) throw shopError;
    const shopToday = ((shopRows || []) as InspectionRow[])[0] || null;
    const progressIds = inspections.map((row) => row.id);
    if (shopToday && !progressIds.includes(shopToday.id)) progressIds.push(shopToday.id);
    const progress = await progressFor(admin, progressIds);
    const shopTemplate = ((templateRows || []) as TemplateRow[])
      .find((template) => template.template_type === "shop_closing" && template.status === "published") || null;

    return NextResponse.json({
      templates,
      isAdmin: canManageTemplates(me),
      inspections: inspections.map((row) => inspectionForClient(row, names, today, progress.get(row.id))),
      shopClosing: {
        templateId: shopTemplate ? shopTemplate.id : null,
        templateName: shopTemplate ? shopTemplate.name : null,
        todayRecord: shopToday ? inspectionForClient(shopToday, names, today, progress.get(shopToday.id)) : null,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

function sanitizeFileName(name: string) {
  const clean = name.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120);
  return clean || "file";
}

function validateFile(file: File) {
  if (file.size === 0) return "The file is empty";
  if (file.size > MAX_FILE_BYTES) return "The file is larger than 25 MB";
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return "File type not allowed";
  return null;
}

function parseDateField(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  return text;
}

function textField(value: unknown, max: number) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

async function requireAssignableMember(admin: AdminClient, memberId: number) {
  const { data, error } = await admin
    .from("members")
    .select("id, approval_status, active")
    .eq("id", memberId)
    .maybeSingle<{ id: number; approval_status: string; active: boolean }>();
  if (error) throw error;
  if (!data) return false;
  return data.active === true && data.approval_status === "approved";
}

type TemplateItemInput = {
  prompt: string; responseType: ItemResponseType; allowsPhoto: boolean; required: boolean;
};

function parseTemplateItems(value: unknown): TemplateItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEMPLATE_ITEMS) return null;
  const items: TemplateItemInput[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") return null;
    const prompt = textField(raw.prompt, 500);
    if (!prompt) return null;
    const responseType = ITEM_RESPONSE_TYPES.includes(raw.responseType as ItemResponseType)
      ? (raw.responseType as ItemResponseType) : "status";
    items.push({
      prompt,
      responseType,
      allowsPhoto: raw.allowsPhoto === true,
      required: raw.required !== false,
    });
  }
  return items;
}

async function replaceTemplateItems(admin: AdminClient, templateId: number, items: TemplateItemInput[]) {
  const { error: deleteError } = await admin
    .from("inspection_template_items").delete().eq("template_id", templateId);
  if (deleteError) throw deleteError;
  const rows = items.map((item, index) => ({
    template_id: templateId,
    position: index + 1,
    prompt: item.prompt,
    response_type: item.responseType,
    allows_photo: item.allowsPhoto,
    required: item.required,
  }));
  const { error } = await admin.from("inspection_template_items").insert(rows);
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const contentType = req.headers.get("content-type") || "";

    // --- Multipart action: attach evidence (any approved account) ---
    if (contentType.includes("multipart/form-data")) {
      if (!canAttachInspectionFile(me)) throw new Error("FORBIDDEN");
      const form = await req.formData();
      const action = String(form.get("action") || "");
      if (action !== "upload_attachment") {
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      }
      const inspectionId = Number(form.get("inspectionId") || 0);
      if (!inspectionId) return NextResponse.json({ error: "Inspection is required" }, { status: 400 });
      const inspection = await getInspectionOr404(admin, inspectionId);
      if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
      const resultId = form.get("resultId") ? Number(form.get("resultId")) : null;
      const correctiveActionId = form.get("correctiveActionId") ? Number(form.get("correctiveActionId")) : null;
      if (resultId) {
        const result = await getResultOr404(admin, resultId);
        if (!result || result.inspection_id !== inspection.id) {
          return NextResponse.json({ error: "Result not found in this inspection" }, { status: 400 });
        }
      }
      if (correctiveActionId) {
        const corrective = await getCorrectiveOr404(admin, correctiveActionId);
        if (!corrective || corrective.inspection_id !== inspection.id) {
          return NextResponse.json({ error: "Corrective action not found in this inspection" }, { status: 400 });
        }
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required" }, { status: 400 });
      }
      const fileError = validateFile(file);
      if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
      const storagePath = `${inspection.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const buffer = await file.arrayBuffer();
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: attachment, error: insertError } = await admin.from("inspection_attachments").insert({
        inspection_id: inspection.id,
        result_id: resultId,
        corrective_action_id: correctiveActionId,
        storage_path: storagePath,
        file_name: file.name,
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by_member_id: me.id,
        uploaded_by_user_id: me.user_id,
      }).select("*").single<AttachmentRow>();
      if (insertError) {
        await admin.storage.from(BUCKET).remove([storagePath]);
        throw insertError;
      }
      await writeHistory(admin, me, inspection.id, "attachment_added", {
        attachmentId: attachment.id, fileName: file.name, resultId, correctiveActionId,
      }, correctiveActionId);
      return NextResponse.json({ attachmentId: attachment.id });
    }

    // --- JSON actions ---
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || "");
    const now = new Date().toISOString();

    // ---------- Template administration (administrator only) ----------
    if (action === "create_template" || action === "update_template" || action === "set_template_status") {
      if (!canManageTemplates(me)) throw new Error("FORBIDDEN");

      if (action === "create_template") {
        const name = textField(body.name, 200);
        if (!name) return NextResponse.json({ error: "Template name is required" }, { status: 400 });
        const templateType = TEMPLATE_TYPES.includes(body.templateType as TemplateType)
          ? (body.templateType as TemplateType) : "inspection";
        const frequencyType = FREQUENCY_TYPES.includes(body.frequencyType as FrequencyType)
          ? (body.frequencyType as FrequencyType) : "none";
        const items = parseTemplateItems(body.items);
        if (!items) return NextResponse.json({ error: "Add at least one valid checklist item" }, { status: 400 });
        const { data: created, error } = await admin.from("inspection_templates").insert({
          name,
          template_type: templateType,
          area_label: textField(body.areaLabel, 160),
          description: textField(body.description, 2000),
          frequency_type: frequencyType,
          frequency_note: textField(body.frequencyNote, 500),
          status: "draft",
          created_by_member_id: me.id,
          created_by_user_id: me.user_id,
        }).select("*").single<TemplateRow>();
        if (error) throw error;
        await replaceTemplateItems(admin, created.id, items);
        await writeTemplateAudit(admin, me, "create_inspection_template", created, {
          templateType, frequencyType, itemCount: items.length,
        });
        return NextResponse.json({ templateId: created.id });
      }

      const templateId = Number(body.id || body.templateId || 0);
      if (!templateId) return NextResponse.json({ error: "Template is required" }, { status: 400 });
      const template = await getTemplateOr404(admin, templateId);
      if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

      if (action === "set_template_status") {
        const target = String(body.status || "") as TemplateStatus;
        if (!TEMPLATE_STATUSES.includes(target)) {
          return NextResponse.json({ error: "Choose a valid template status" }, { status: 400 });
        }
        if (target === template.status) return NextResponse.json({ ok: true });
        const { error } = await admin.from("inspection_templates")
          .update({ status: target, updated_at: now }).eq("id", template.id);
        if (error) throw error;
        await writeTemplateAudit(
          admin, me,
          target === "published" ? "publish_inspection_template"
            : target === "archived" ? "archive_inspection_template"
              : "update_inspection_template",
          template, { from: template.status, to: target },
        );
        return NextResponse.json({ ok: true });
      }

      // update_template
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.name !== undefined) {
        const name = textField(body.name, 200);
        if (!name) return NextResponse.json({ error: "Template name is required" }, { status: 400 });
        update.name = name; changed.push("name");
      }
      if (body.areaLabel !== undefined) { update.area_label = textField(body.areaLabel, 160); changed.push("areaLabel"); }
      if (body.description !== undefined) { update.description = textField(body.description, 2000); changed.push("description"); }
      if (body.frequencyType !== undefined) {
        if (!FREQUENCY_TYPES.includes(body.frequencyType as FrequencyType)) {
          return NextResponse.json({ error: "Choose a valid frequency" }, { status: 400 });
        }
        update.frequency_type = body.frequencyType; changed.push("frequencyType");
      }
      if (body.frequencyNote !== undefined) { update.frequency_note = textField(body.frequencyNote, 500); changed.push("frequencyNote"); }
      let newItems: TemplateItemInput[] | null = null;
      if (body.items !== undefined) {
        newItems = parseTemplateItems(body.items);
        if (!newItems) return NextResponse.json({ error: "Add at least one valid checklist item" }, { status: 400 });
        changed.push("items");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("inspection_templates").update(update).eq("id", template.id);
      if (error) throw error;
      if (newItems) await replaceTemplateItems(admin, template.id, newItems);
      await writeTemplateAudit(admin, me, "update_inspection_template", template, {
        changed, itemCount: newItems ? newItems.length : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    // ---------- Create an inspection (any approved account) ----------
    if (action === "create_inspection") {
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      let template: TemplateRow | null = null;
      let snapshotItems: TemplateItemInput[] = [];
      let itemIds: (number | null)[] = [];
      const templateId = body.templateId ? Number(body.templateId) : 0;
      if (templateId) {
        template = await getTemplateOr404(admin, templateId);
        if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
        if (!canStartFromTemplate(me, template)) {
          return NextResponse.json({ error: "Only a published template can be started" }, { status: 400 });
        }
        const { data: itemRows, error: itemError } = await admin
          .from("inspection_template_items").select("*")
          .eq("template_id", template.id).order("position", { ascending: true });
        if (itemError) throw itemError;
        const rows = (itemRows || []) as TemplateItemRow[];
        if (!rows.length) return NextResponse.json({ error: "The template has no items" }, { status: 400 });
        snapshotItems = rows.map((row) => ({
          prompt: row.prompt, responseType: row.response_type,
          allowsPhoto: row.allows_photo, required: row.required,
        }));
        itemIds = rows.map((row) => row.id);
      } else {
        const items = parseTemplateItems(body.items);
        if (!items) return NextResponse.json({ error: "Add at least one checklist item" }, { status: 400 });
        snapshotItems = items;
        itemIds = items.map(() => null);
      }
      const scheduledDate = parseDateField(body.scheduledDate) ?? localDate(new Date());
      if (scheduledDate === "INVALID") {
        return NextResponse.json({ error: "Scheduled date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const templateType: TemplateType = template ? template.template_type : "inspection";
      // The shop closing record is unique per day: one record, signed
      // once. A second start returns the record that already exists.
      if (templateType === "shop_closing") {
        const { data: existing, error: existingError } = await admin
          .from("inspections").select("id")
          .eq("template_type", "shop_closing").eq("scheduled_date", scheduledDate)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length) {
          return NextResponse.json({
            error: "A shop closing record already exists for that date",
            existingInspectionId: existing[0].id,
          }, { status: 400 });
        }
      }
      const title = textField(body.title, 240)
        || (template ? template.name : null)
        || "Inspection";
      let assignedMemberId = body.assignedMemberId ? Number(body.assignedMemberId) : me.id;
      if (assignedMemberId && !(await requireAssignableMember(admin, assignedMemberId))) {
        return NextResponse.json({ error: "Assigned member is not an approved account" }, { status: 400 });
      }
      if (!assignedMemberId) assignedMemberId = me.id;

      const year = Number(localDate(new Date()).slice(0, 4));
      const { data: folioNumber, error: folioError } = await admin
        .rpc("next_inspection_folio_number", { p_year: year });
      if (folioError) throw folioError;
      const folio = `INS-${year}-${String(folioNumber).padStart(4, "0")}`;

      const { data: created, error: createError } = await admin.from("inspections").insert({
        folio,
        template_id: template ? template.id : null,
        template_name: template ? template.name : null,
        template_type: templateType,
        frequency_type: template ? template.frequency_type : null,
        frequency_note: template ? template.frequency_note : null,
        title,
        building: textField(body.building, 120),
        unit: textField(body.unit, 60),
        area: textField(body.area, 120) || (template ? template.area_label : null),
        equipment: textField(body.equipment, 160),
        assigned_member_id: assignedMemberId,
        scheduled_date: scheduledDate,
        status: "scheduled",
        general_notes: textField(body.generalNotes, 5000),
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("*").single<InspectionRow>();
      if (createError) throw createError;

      const resultRows = snapshotItems.map((item, index) => ({
        inspection_id: created.id,
        template_item_id: itemIds[index],
        position: index + 1,
        prompt: item.prompt,
        response_type: item.responseType,
        allows_photo: item.allowsPhoto,
        required: item.required,
      }));
      const { error: resultsError } = await admin.from("inspection_results").insert(resultRows);
      if (resultsError) throw resultsError;
      await writeHistory(admin, me, created.id, "created", {
        folio, templateId: template ? template.id : null, templateType, itemCount: resultRows.length,
      });
      return NextResponse.json({ inspectionId: created.id, folio });
    }

    // ---------- Corrective actions ----------
    if (action === "create_corrective_action") {
      const resultId = Number(body.resultId || 0);
      if (!resultId) return NextResponse.json({ error: "Result is required" }, { status: 400 });
      const result = await getResultOr404(admin, resultId);
      if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });
      if (!canCreateCorrectiveAction(me, result)) {
        return NextResponse.json({
          error: "Corrective actions are generated from a finding (pending, in progress or waiting)",
        }, { status: 400 });
      }
      const description = textField(body.description, 5000);
      if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
      const dueDate = parseDateField(body.dueDate);
      if (dueDate === "INVALID") {
        return NextResponse.json({ error: "Due date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
      if (responsibleMemberId && !(await requireAssignableMember(admin, responsibleMemberId))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      const link = await validateCorrectiveLinks(admin, body);
      if (link.error) return NextResponse.json({ error: link.error }, { status: 400 });
      const { data: created, error } = await admin.from("corrective_actions").insert({
        inspection_id: result.inspection_id,
        result_id: result.id,
        description,
        responsible_member_id: responsibleMemberId,
        due_date: dueDate,
        status: "open",
        work_order_id: link.workOrderId,
        log_event_id: link.logEventId,
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("*").single<CorrectiveRow>();
      if (error) throw error;
      await writeHistory(admin, me, result.inspection_id, "corrective_created", {
        correctiveActionId: created.id, resultId: result.id,
        workOrderId: link.workOrderId, logEventId: link.logEventId,
      }, created.id);
      return NextResponse.json({ correctiveActionId: created.id });
    }

    if (action === "update_corrective_action" || action === "complete_corrective_action"
      || action === "verify_corrective_action" || action === "link_corrective_action") {
      const correctiveId = Number(body.id || body.correctiveActionId || 0);
      if (!correctiveId) return NextResponse.json({ error: "Corrective action is required" }, { status: 400 });
      const corrective = await getCorrectiveOr404(admin, correctiveId);
      if (!corrective) return NextResponse.json({ error: "Corrective action not found" }, { status: 404 });

      if (action === "complete_corrective_action") {
        if (!canCompleteCorrectiveAction(me, corrective)) {
          return NextResponse.json({ error: "Only an open corrective action can be completed" }, { status: 400 });
        }
        const { error } = await admin.from("corrective_actions").update({
          status: "completed", completed_by_member_id: me.id, completed_at: now, updated_at: now,
        }).eq("id", corrective.id);
        if (error) throw error;
        await writeHistory(admin, me, corrective.inspection_id, "corrective_completed", {
          correctiveActionId: corrective.id,
        }, corrective.id);
        return NextResponse.json({ ok: true });
      }

      if (action === "verify_corrective_action") {
        if (!canVerifyCorrectiveAction(me, corrective)) {
          return NextResponse.json({
            error: corrective.status !== "completed"
              ? "Only a completed corrective action can be verified"
              : "The corrective action is already verified",
          }, { status: 400 });
        }
        const { error } = await admin.from("corrective_actions").update({
          status: "verified", verified_by_member_id: me.id, verified_at: now, updated_at: now,
        }).eq("id", corrective.id);
        if (error) throw error;
        await writeHistory(admin, me, corrective.inspection_id, "corrective_verified", {
          correctiveActionId: corrective.id,
        }, corrective.id);
        return NextResponse.json({ ok: true });
      }

      if (action === "link_corrective_action") {
        if (!canUpdateCorrectiveAction(me, corrective) && corrective.status !== "completed") {
          return NextResponse.json({ error: "A verified corrective action cannot be relinked" }, { status: 400 });
        }
        const link = await validateCorrectiveLinks(admin, body);
        if (link.error) return NextResponse.json({ error: link.error }, { status: 400 });
        const { error } = await admin.from("corrective_actions").update({
          work_order_id: link.workOrderId, log_event_id: link.logEventId, updated_at: now,
        }).eq("id", corrective.id);
        if (error) throw error;
        await writeHistory(admin, me, corrective.inspection_id, "corrective_linked", {
          correctiveActionId: corrective.id,
          workOrderId: link.workOrderId, logEventId: link.logEventId,
        }, corrective.id);
        return NextResponse.json({ ok: true });
      }

      // update_corrective_action
      if (!canUpdateCorrectiveAction(me, corrective)) {
        return NextResponse.json({ error: "A completed or verified corrective action cannot be edited" }, { status: 400 });
      }
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.description !== undefined) {
        const description = textField(body.description, 5000);
        if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
        update.description = description; changed.push("description");
      }
      if (body.responsibleMemberId !== undefined) {
        const target = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
        if (target && !(await requireAssignableMember(admin, target))) {
          return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
        }
        update.responsible_member_id = target; changed.push("responsibleMemberId");
      }
      if (body.dueDate !== undefined) {
        const dueDate = parseDateField(body.dueDate);
        if (dueDate === "INVALID") {
          return NextResponse.json({ error: "Due date must use YYYY-MM-DD format" }, { status: 400 });
        }
        update.due_date = dueDate; changed.push("dueDate");
      }
      if (body.status !== undefined) {
        const target = String(body.status || "");
        if (target !== "open" && target !== "in_progress") {
          return NextResponse.json({ error: "Use the complete action to complete a corrective action" }, { status: 400 });
        }
        update.status = target; changed.push("status");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("corrective_actions").update(update).eq("id", corrective.id);
      if (error) throw error;
      await writeHistory(admin, me, corrective.inspection_id, "corrective_updated", {
        correctiveActionId: corrective.id, changed,
      }, corrective.id);
      return NextResponse.json({ ok: true });
    }

    // ---------- Actions on an existing inspection ----------
    const inspectionId = Number(body.id || body.inspectionId || 0);
    if (!inspectionId) return NextResponse.json({ error: "Inspection is required" }, { status: 400 });
    const inspection = await getInspectionOr404(admin, inspectionId);
    if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    if (action === "add_reading") {
      // Structured measurement (Phase 5): a labelled value with its
      // unit and location, optionally pinned to one checklist result.
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      const label = textField(body.label, 200);
      if (!label) return NextResponse.json({ error: "A reading label is required" }, { status: 400 });
      const resultId = body.resultId ? Number(body.resultId) : null;
      if (resultId) {
        const result = await getResultOr404(admin, resultId);
        if (!result || result.inspection_id !== inspection.id) {
          return NextResponse.json({ error: "Result not found in this inspection" }, { status: 400 });
        }
      }
      const { data: reading, error } = await admin.from("inspection_readings").insert({
        inspection_id: inspection.id,
        result_id: resultId,
        label,
        value: body.value === undefined || body.value === null ? null : String(body.value).trim().slice(0, 200) || null,
        unit: textField(body.unit, 40),
        location: textField(body.location, 200),
        measured_at: now,
        recorded_by_member_id: me.id,
        recorded_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "details_updated", {
        readingId: reading.id, label, resultId,
      });
      return NextResponse.json({ readingId: reading.id });
    }

    if (action === "update_inspection") {
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      if (inspection.status === "completed") {
        return NextResponse.json({ error: "Reopen the inspection before editing it" }, { status: 400 });
      }
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      const textMap: [string, string, number][] = [
        ["building", "building", 120], ["unit", "unit", 60], ["area", "area", 120],
        ["equipment", "equipment", 160], ["generalNotes", "general_notes", 5000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      if (body.title !== undefined) {
        const title = textField(body.title, 240);
        if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        update.title = title; changed.push("title");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("inspections").update(update).eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "details_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign_inspection") {
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      const target = body.assignedMemberId ? Number(body.assignedMemberId) : null;
      if (target && !(await requireAssignableMember(admin, target))) {
        return NextResponse.json({ error: "Assigned member is not an approved account" }, { status: 400 });
      }
      if (target === inspection.assigned_member_id) return NextResponse.json({ ok: true });
      const { error } = await admin.from("inspections")
        .update({ assigned_member_id: target, updated_at: now }).eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "assigned", {
        fromMemberId: inspection.assigned_member_id, toMemberId: target,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_schedule") {
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      if (inspection.status === "completed") {
        return NextResponse.json({ error: "Reopen the inspection before rescheduling it" }, { status: 400 });
      }
      const target = parseDateField(body.scheduledDate);
      if (target === "INVALID" || !target) {
        return NextResponse.json({ error: "Scheduled date must use YYYY-MM-DD format" }, { status: 400 });
      }
      if (inspection.template_type === "shop_closing" && target !== inspection.scheduled_date) {
        // One shop closing record per day: moving the date must not
        // collide with the record of the target day.
        const { data: clash, error: clashError } = await admin
          .from("inspections").select("id")
          .eq("template_type", "shop_closing").eq("scheduled_date", target)
          .neq("id", inspection.id).limit(1);
        if (clashError) throw clashError;
        if (clash && clash.length) {
          return NextResponse.json({ error: "A shop closing record already exists for that date" }, { status: 400 });
        }
      }
      if (target === inspection.scheduled_date) return NextResponse.json({ ok: true });
      const { error } = await admin.from("inspections")
        .update({ scheduled_date: target, updated_at: now }).eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "schedule_changed", {
        from: inspection.scheduled_date, to: target,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "start_inspection") {
      if (!canExecuteInspection(me)) throw new Error("FORBIDDEN");
      if (inspection.status === "completed") {
        return NextResponse.json({ error: "Reopen the inspection before starting it again" }, { status: 400 });
      }
      if (inspection.status === "in_progress") return NextResponse.json({ ok: true });
      const { error } = await admin.from("inspections")
        .update({ status: "in_progress", started_at: inspection.started_at || now, updated_at: now })
        .eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "started", {});
      return NextResponse.json({ ok: true });
    }

    if (action === "record_result") {
      const resultId = Number(body.resultId || 0);
      if (!resultId) return NextResponse.json({ error: "Result is required" }, { status: 400 });
      const result = await getResultOr404(admin, resultId);
      if (!result || result.inspection_id !== inspection.id) {
        return NextResponse.json({ error: "Result not found in this inspection" }, { status: 404 });
      }
      if (!canRecordResult(me, inspection)) {
        return NextResponse.json({ error: "A completed inspection is locked; reopen it to change results" }, { status: 400 });
      }
      let status: ItemResultStatus | null = null;
      if (body.status !== undefined && body.status !== null && body.status !== "") {
        if (!ITEM_RESULT_STATUSES.includes(body.status as ItemResultStatus)) {
          return NextResponse.json({ error: "Choose a valid result" }, { status: 400 });
        }
        status = body.status as ItemResultStatus;
      }
      let answer: ItemAnswer | null = null;
      if (result.response_type === "yes_no" && body.answer !== undefined && body.answer !== null && body.answer !== "") {
        if (body.answer !== "yes" && body.answer !== "no") {
          return NextResponse.json({ error: "Choose yes or no" }, { status: 400 });
        }
        answer = body.answer as ItemAnswer;
      }
      const note = body.note !== undefined ? textField(body.note, 2000) : result.note;
      const answered = status != null || answer != null;
      // Answering the first item starts the inspection (recorded).
      if (inspection.status === "scheduled" && answered) {
        const { error: startError } = await admin.from("inspections")
          .update({ status: "in_progress", started_at: inspection.started_at || now, updated_at: now })
          .eq("id", inspection.id);
        if (startError) throw startError;
        await writeHistory(admin, me, inspection.id, "started", { via: "first_result" });
      }
      const { error } = await admin.from("inspection_results").update({
        status,
        answer: result.response_type === "yes_no" ? answer : null,
        note,
        answered_by_member_id: answered ? me.id : null,
        answered_at: answered ? now : null,
        updated_at: now,
      }).eq("id", result.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "result_recorded", {
        resultId: result.id, position: result.position,
        from: result.status, to: status, answer,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "complete_inspection") {
      const { data: resultRows, error: resultError } = await admin
        .from("inspection_results").select("*").eq("inspection_id", inspection.id);
      if (resultError) throw resultError;
      const results = (resultRows || []) as ResultRow[];
      if (!canCompleteInspection(me, inspection, results.map((row) => ({
        required: row.required,
        status: row.status as ItemResultStatus | null,
        answer: row.answer as ItemAnswer | null,
      })))) {
        return NextResponse.json({
          error: inspection.status === "completed"
            ? "The inspection is already completed"
            : "Every required item must be answered before completing",
        }, { status: 400 });
      }
      // Shop closing signature: the typed name plus the server
      // timestamp recorded below is the signature of the record.
      const signatureName = inspection.template_type === "shop_closing"
        ? textField(body.signatureName, 120) || me.name
        : null;
      const { error } = await admin.from("inspections").update({
        status: "completed",
        completed_by_member_id: me.id,
        completed_at: now,
        signature_name: signatureName,
        updated_at: now,
      }).eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "completed", {
        answered: results.filter((row) => row.status != null).length,
        total: results.length,
        signatureName,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reopen_inspection") {
      if (!canReopenInspection(me, inspection)) {
        return NextResponse.json({ error: "Only a completed inspection can be reopened" }, { status: 400 });
      }
      const { error } = await admin.from("inspections").update({
        status: "in_progress",
        completed_by_member_id: null, completed_at: null, signature_name: null,
        updated_at: now,
      }).eq("id", inspection.id);
      if (error) throw error;
      await writeHistory(admin, me, inspection.id, "reopened", {
        previousCompletedAt: inspection.completed_at,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}

/** Validates optional corrective-action links: both targets must exist. */
async function validateCorrectiveLinks(
  admin: AdminClient,
  body: Record<string, unknown>,
): Promise<{ workOrderId: number | null; logEventId: number | null; error?: string }> {
  let workOrderId: number | null = null;
  let logEventId: number | null = null;
  if (body.workOrderId) {
    workOrderId = Number(body.workOrderId);
    const { data, error } = await admin.from("work_orders").select("id").eq("id", workOrderId).maybeSingle();
    if (error) throw error;
    if (!data) return { workOrderId: null, logEventId: null, error: "Linked work order not found" };
  }
  if (body.logEventId) {
    logEventId = Number(body.logEventId);
    const { data, error } = await admin.from("log_events").select("id").eq("id", logEventId).maybeSingle();
    if (error) throw error;
    if (!data) return { workOrderId: null, logEventId: null, error: "Linked logbook event not found" };
  }
  return { workOrderId, logEventId };
}
