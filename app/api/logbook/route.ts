import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, type MemberRow } from "@/lib/access";
import { localDate } from "@/lib/time";
import {
  assignmentNotificationRecipients,
  canAccessLogbook,
  canAttach,
  canCloseEvent,
  canComment,
  canCreateEvent,
  canLinkEvents,
  canReopenEvent,
  canUpdateEvent,
  canVerifyEvent,
  commentNotificationRecipients,
  isFollowUpOverdue,
  LOG_EVENT_STATUSES,
  LOG_EVENT_TYPES,
  LOG_LINK_RELATIONS,
  LOG_PRIORITIES,
  type LogEventStatus,
  type LogEventType,
  type LogLinkRelation,
  type LogPriority,
} from "@/lib/logbook-rules";

/**
 * Property logbook API (Phase 2).
 *
 * Every permission decision is made HERE, on the server, per request, from
 * the database state — the UI only mirrors them:
 * - Unapproved accounts (pending / rejected / suspended / revoked) get 403
 *   on everything: no list, no detail, no comments, no attachments.
 * - Every approved account has the SAME operational permissions: create,
 *   update, comment, attach, link, close, reopen and verify events.
 *   Administration (is_admin) grants nothing extra in this module.
 * - Nothing is ever deleted through this API: no event, comment,
 *   attachment record or history row has a delete or edit path. Closing
 *   an event keeps the record, its evidence and its history.
 * - log_history is append-only and written only by this server code,
 *   in the same request as the change it records.
 * - Files live in the private "logbook" Storage bucket. Bytes are never
 *   served by this route; downloads go through the signed-URL route after
 *   the same checks (app/api/logbook/download).
 */

const BUCKET = "logbook";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md",
]);
const LIST_LIMIT = 300;

type LogEventRow = {
  id: number; folio: string; event_type: LogEventType; occurred_at: string;
  reported_by_member_id: number | null; reported_by_user_id: string | null;
  building: string | null; unit: string | null; area: string | null;
  equipment: string | null; description: string; findings: string | null;
  actions_taken: string | null; responsible_member_id: number | null;
  priority: LogPriority; follow_up_date: string | null;
  status: LogEventStatus; final_result: string | null;
  verified_by_member_id: number | null; verified_at: string | null;
  official_wo_ref: string | null;
  closed_by_member_id: number | null; closed_at: string | null;
  created_at: string; updated_at: string;
};

type CommentRow = {
  id: number; event_id: number; author_member_id: number | null;
  body: string; created_at: string;
};

type HistoryRow = {
  id: number; event_id: number; actor_member_id: number | null;
  actor_email: string; action: string; detail: Record<string, unknown>;
  created_at: string;
};

type AttachmentRow = {
  id: number; event_id: number; file_name: string;
  content_type: string | null; file_size: number | null;
  uploaded_by_member_id: number | null; created_at: string;
};

type LinkRow = {
  id: number; event_id: number; related_event_id: number;
  relation: LogLinkRelation; created_at: string;
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
  if (!canAccessLogbook(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

async function memberNames(admin: AdminClient) {
  const { data, error } = await admin.from("members").select("id, name");
  if (error) throw error;
  return new Map(((data || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
}

async function getEventOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("log_events").select("*").eq("id", id).maybeSingle<LogEventRow>();
  if (error) throw error;
  if (!data) return null;
  return data;
}

/** Append-only history: the ONLY write this module ever makes to it. */
async function writeHistory(
  admin: AdminClient,
  actor: MemberRow,
  eventId: number,
  action: HistoryRow["action"],
  detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("log_history").insert({
    event_id: eventId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

async function notify(
  admin: AdminClient,
  recipients: number[],
  type: "log_assigned" | "log_comment",
  eventId: number,
  actor: MemberRow,
) {
  if (!recipients.length) return;
  const rows = recipients.map((recipientId) => ({
    recipient_member_id: recipientId,
    type,
    event_id: eventId,
    actor_member_id: actor.id,
  }));
  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw error;
}

function locationLabel(event: LogEventRow) {
  const parts = [event.building, event.unit, event.area, event.equipment]
    .map((part) => (part || "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

function eventForClient(
  event: LogEventRow,
  names: Map<number, string>,
  today: string,
  counts?: { comments: number; attachments: number },
) {
  const name = (id: number | null) => (id ? names.get(id) || null : null);
  return {
    id: event.id,
    folio: event.folio,
    eventType: event.event_type,
    occurredAt: event.occurred_at,
    registeredAt: event.created_at,
    updatedAt: event.updated_at,
    reportedByMemberId: event.reported_by_member_id,
    reportedByName: name(event.reported_by_member_id),
    building: event.building,
    unit: event.unit,
    area: event.area,
    equipment: event.equipment,
    location: locationLabel(event),
    description: event.description,
    findings: event.findings,
    actionsTaken: event.actions_taken,
    responsibleMemberId: event.responsible_member_id,
    responsibleName: name(event.responsible_member_id),
    priority: event.priority,
    followUpDate: event.follow_up_date,
    status: event.status,
    finalResult: event.final_result,
    verifiedByMemberId: event.verified_by_member_id,
    verifiedByName: name(event.verified_by_member_id),
    verifiedAt: event.verified_at,
    officialWoRef: event.official_wo_ref,
    closedByMemberId: event.closed_by_member_id,
    closedByName: name(event.closed_by_member_id),
    closedAt: event.closed_at,
    overdue: isFollowUpOverdue(event, today),
    commentCount: counts?.comments ?? null,
    attachmentCount: counts?.attachments ?? null,
  };
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
      const { data, error } = await admin
        .from("log_events")
        .select("*")
        .neq("status", "closed")
        .order("follow_up_date", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      const open = (data || []) as LogEventRow[];
      const openByPriority: Record<LogPriority, number> = { emergency: 0, high: 0, medium: 0, low: 0 };
      for (const event of open) openByPriority[event.priority] += 1;
      const overdue = open
        .filter((event) => isFollowUpOverdue(event, today))
        .sort((a, b) => String(a.follow_up_date).localeCompare(String(b.follow_up_date)));
      return NextResponse.json({
        openTotal: open.length,
        openByPriority,
        overdueTotal: overdue.length,
        overdue: overdue.slice(0, 5).map((event) => eventForClient(event, names, today)),
      });
    }

    // --- Detail: one event with its case chain, comments, files, history ---
    const detailId = Number(params.get("id") || 0);
    if (detailId) {
      const event = await getEventOr404(admin, detailId);
      if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

      // Traverse the case chain in BOTH directions over log_event_links.
      const chainIds = new Set<number>([event.id]);
      const relationById = new Map<number, LogLinkRelation>();
      let frontier = [event.id];
      for (let step = 0; step < 20 && frontier.length; step += 1) {
        const { data: linkRows, error: linkError } = await admin
          .from("log_event_links")
          .select("*")
          .or(`event_id.in.(${frontier.join(",")}),related_event_id.in.(${frontier.join(",")})`);
        if (linkError) throw linkError;
        const next: number[] = [];
        for (const link of (linkRows || []) as LinkRow[]) {
          for (const candidate of [link.event_id, link.related_event_id]) {
            if (!chainIds.has(candidate)) {
              chainIds.add(candidate);
              relationById.set(candidate, link.relation);
              next.push(candidate);
            }
          }
        }
        frontier = next;
        if (chainIds.size > 100) break;
      }
      const { data: chainRows, error: chainError } = await admin
        .from("log_events").select("*").in("id", [...chainIds]);
      if (chainError) throw chainError;
      const chain = ((chainRows || []) as LogEventRow[])
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.created_at.localeCompare(b.created_at))
        .map((row) => ({
          ...eventForClient(row, names, today),
          relation: row.id === event.id ? null : relationById.get(row.id) || "related",
          isSelf: row.id === event.id,
        }));

      const [{ data: commentRows, error: commentError },
        { data: attachmentRows, error: attachmentError },
        { data: historyRows, error: historyError }] = await Promise.all([
        admin.from("log_comments").select("*").eq("event_id", event.id).order("created_at", { ascending: true }),
        admin.from("log_attachments").select("*").eq("event_id", event.id).order("created_at", { ascending: true }),
        admin.from("log_history").select("*").eq("event_id", event.id).order("created_at", { ascending: true }).limit(500),
      ]);
      if (commentError) throw commentError;
      if (attachmentError) throw attachmentError;
      if (historyError) throw historyError;

      return NextResponse.json({
        event: eventForClient(event, names, today, {
          comments: (commentRows || []).length,
          attachments: (attachmentRows || []).length,
        }),
        chain,
        comments: ((commentRows || []) as CommentRow[]).map((comment) => ({
          id: comment.id,
          body: comment.body,
          authorMemberId: comment.author_member_id,
          authorName: comment.author_member_id ? names.get(comment.author_member_id) || null : null,
          createdAt: comment.created_at,
        })),
        attachments: ((attachmentRows || []) as AttachmentRow[]).map((file) => ({
          id: file.id,
          fileName: file.file_name,
          contentType: file.content_type,
          fileSize: file.file_size,
          uploadedByMemberId: file.uploaded_by_member_id,
          uploadedByName: file.uploaded_by_member_id ? names.get(file.uploaded_by_member_id) || null : null,
          createdAt: file.created_at,
        })),
        history: ((historyRows || []) as HistoryRow[]).map((entry) => ({
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

    // --- List with filters, my notifications and my overdue attention ---
    let query = admin
      .from("log_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    const status = params.get("status");
    const priority = params.get("priority");
    const type = params.get("type");
    const responsible = params.get("responsible");
    if (status && LOG_EVENT_STATUSES.includes(status as LogEventStatus)) query = query.eq("status", status);
    if (priority && LOG_PRIORITIES.includes(priority as LogPriority)) query = query.eq("priority", priority);
    if (type && LOG_EVENT_TYPES.includes(type as LogEventType)) query = query.eq("event_type", type);
    if (responsible && Number(responsible)) query = query.eq("responsible_member_id", Number(responsible));
    const { data: eventRows, error: eventError } = await query;
    if (eventError) throw eventError;
    let events = (eventRows || []) as LogEventRow[];
    const q = (params.get("q") || "").trim().toLowerCase();
    if (q) {
      events = events.filter((event) =>
        [event.folio, event.building, event.unit, event.area, event.equipment, event.description, event.official_wo_ref]
          .some((field) => (field || "").toLowerCase().includes(q)));
    }
    const ids = events.map((event) => event.id);
    const counts = new Map<number, { comments: number; attachments: number }>();
    if (ids.length) {
      const [{ data: commentIds, error: cErr }, { data: attachmentIds, error: aErr }] = await Promise.all([
        admin.from("log_comments").select("event_id").in("event_id", ids),
        admin.from("log_attachments").select("event_id").in("event_id", ids),
      ]);
      if (cErr) throw cErr;
      if (aErr) throw aErr;
      for (const row of (commentIds || []) as { event_id: number }[]) {
        const entry = counts.get(row.event_id) || { comments: 0, attachments: 0 };
        entry.comments += 1; counts.set(row.event_id, entry);
      }
      for (const row of (attachmentIds || []) as { event_id: number }[]) {
        const entry = counts.get(row.event_id) || { comments: 0, attachments: 0 };
        entry.attachments += 1; counts.set(row.event_id, entry);
      }
    }

    // Stored notifications for me (assignment / comments on my events).
    const { data: notificationRows, error: notificationError } = await admin
      .from("notifications")
      .select("*")
      .eq("recipient_member_id", me.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (notificationError) throw notificationError;
    type NotificationRow = {
      id: number; type: string; event_id: number | null;
      actor_member_id: number | null; read_at: string | null; created_at: string;
    };
    const notifications = (notificationRows || []) as NotificationRow[];
    const notificationEventIds = [...new Set(notifications.map((n) => n.event_id).filter(Boolean))] as number[];
    const folioById = new Map<number, string>();
    if (notificationEventIds.length) {
      const { data: folioRows, error: folioError } = await admin
        .from("log_events").select("id, folio").in("id", notificationEventIds);
      if (folioError) throw folioError;
      for (const row of (folioRows || []) as { id: number; folio: string }[]) folioById.set(row.id, row.folio);
    }

    // Overdue follow-ups involving me, computed at read time (never stored).
    const { data: myOpen, error: myOpenError } = await admin
      .from("log_events")
      .select("*")
      .neq("status", "closed")
      .not("follow_up_date", "is", null)
      .or(`responsible_member_id.eq.${me.id},reported_by_member_id.eq.${me.id}`)
      .order("follow_up_date", { ascending: true });
    if (myOpenError) throw myOpenError;
    const attention = ((myOpen || []) as LogEventRow[])
      .filter((event) => isFollowUpOverdue(event, today))
      .map((event) => eventForClient(event, names, today));

    return NextResponse.json({
      events: events.map((event) => eventForClient(event, names, today, counts.get(event.id))),
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        eventId: n.event_id,
        eventFolio: n.event_id ? folioById.get(n.event_id) || null : null,
        actorName: n.actor_member_id ? names.get(n.actor_member_id) || null : null,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unreadNotifications: notifications.filter((n) => !n.read_at).length,
      attention,
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

function parseDateTimeField(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "INVALID";
  return date.toISOString();
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

export async function POST(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const contentType = req.headers.get("content-type") || "";

    // --- Multipart action: attach an evidence file (any approved account) ---
    if (contentType.includes("multipart/form-data")) {
      if (!canAttach(me)) throw new Error("FORBIDDEN");
      const form = await req.formData();
      const action = String(form.get("action") || "");
      if (action !== "upload_attachment") {
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      }
      const eventId = Number(form.get("eventId") || 0);
      if (!eventId) return NextResponse.json({ error: "Event is required" }, { status: 400 });
      const event = await getEventOr404(admin, eventId);
      if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required" }, { status: 400 });
      }
      const fileError = validateFile(file);
      if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
      const storagePath = `${event.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const buffer = await file.arrayBuffer();
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: attachment, error: insertError } = await admin.from("log_attachments").insert({
        event_id: event.id,
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
      await writeHistory(admin, me, event.id, "attachment_added", {
        attachmentId: attachment.id, fileName: file.name,
      });
      return NextResponse.json({ attachmentId: attachment.id });
    }

    // --- JSON actions ---
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || "");
    const now = new Date().toISOString();

    if (action === "create_event") {
      if (!canCreateEvent(me)) throw new Error("FORBIDDEN");
      const eventType = String(body.eventType || "");
      if (!LOG_EVENT_TYPES.includes(eventType as LogEventType)) {
        return NextResponse.json({ error: "Choose a valid event type" }, { status: 400 });
      }
      const occurredAt = parseDateTimeField(body.occurredAt) || now;
      if (occurredAt === "INVALID") {
        return NextResponse.json({ error: "Event date/time is invalid" }, { status: 400 });
      }
      const description = textField(body.description, 5000);
      if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
      const priority = String(body.priority || "medium");
      if (!LOG_PRIORITIES.includes(priority as LogPriority)) {
        return NextResponse.json({ error: "Choose a valid priority" }, { status: 400 });
      }
      const followUpDate = parseDateField(body.followUpDate);
      if (followUpDate === "INVALID") {
        return NextResponse.json({ error: "Follow-up date must use YYYY-MM-DD format" }, { status: 400 });
      }
      let responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : me.id;
      if (responsibleMemberId && !(await requireAssignableMember(admin, responsibleMemberId))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      if (!responsibleMemberId) responsibleMemberId = me.id;

      // Phase 3B: an event can be born linked to an asset (for example from
      // the asset's page). `equipment` stays the free-text field; this adds
      // the structured link without changing anything from Phase 2.
      let bornAssetId: number | null = null;
      if (body.assetId) {
        const { data: asset } = await admin.from("assets")
          .select("id").eq("id", Number(body.assetId))
          .maybeSingle<{ id: number }>();
        if (!asset) return NextResponse.json({ error: "Linked asset not found" }, { status: 400 });
        bornAssetId = asset.id;
      }

      // Mint the readable folio atomically in the database (BIT-YYYY-NNNN).
      const year = Number(localDate(new Date()).slice(0, 4));
      const { data: folioNumber, error: folioError } = await admin
        .rpc("next_log_folio_number", { p_year: year });
      if (folioError) throw folioError;
      const folio = `BIT-${year}-${String(folioNumber).padStart(4, "0")}`;

      const { data: created, error: createError } = await admin.from("log_events").insert({
        folio,
        event_type: eventType,
        occurred_at: occurredAt,
        reported_by_member_id: me.id,
        reported_by_user_id: me.user_id,
        building: textField(body.building, 120),
        unit: textField(body.unit, 60),
        area: textField(body.area, 120),
        equipment: textField(body.equipment, 160),
        asset_id: bornAssetId,
        description,
        findings: textField(body.findings, 5000),
        actions_taken: textField(body.actionsTaken, 5000),
        responsible_member_id: responsibleMemberId,
        priority,
        follow_up_date: followUpDate,
        status: "open",
        official_wo_ref: textField(body.officialWoRef, 120),
      }).select("*").single<LogEventRow>();
      if (createError) throw createError;
      await writeHistory(admin, me, created.id, "created", { folio, eventType });
      if (bornAssetId) {
        // Reflect the birth link on the asset's own append-only history.
        const { error: assetHistoryError } = await admin.from("asset_history").insert({
          asset_id: bornAssetId,
          action: "event_linked",
          detail: { logEventId: created.id, folio, bornLinked: true },
          actor_member_id: me.id,
          actor_user_id: me.user_id,
          actor_email: me.email,
        });
        if (assetHistoryError) throw assetHistoryError;
      }
      await notify(
        admin,
        assignmentNotificationRecipients(me.id, responsibleMemberId),
        "log_assigned",
        created.id,
        me,
      );
      if (body.linkToEventId) {
        const relatedId = Number(body.linkToEventId);
        const relation = LOG_LINK_RELATIONS.includes(body.linkRelation as LogLinkRelation)
          ? (body.linkRelation as LogLinkRelation) : "related";
        const related = relatedId && relatedId !== created.id ? await getEventOr404(admin, relatedId) : null;
        if (related) {
          const { error: linkError } = await admin.from("log_event_links").insert({
            event_id: created.id, related_event_id: related.id, relation,
            created_by_member_id: me.id,
          });
          if (linkError) throw linkError;
          await writeHistory(admin, me, created.id, "linked", {
            relatedEventId: related.id, relatedFolio: related.folio, relation,
          });
        }
      }
      return NextResponse.json({ eventId: created.id, folio });
    }

    if (action === "mark_notifications_read") {
      // Only my own notifications can be marked — the recipient filter is
      // the permission check.
      let update = admin.from("notifications")
        .update({ read_at: now })
        .eq("recipient_member_id", me.id)
        .is("read_at", null);
      if (Array.isArray(body.ids) && body.ids.length) {
        update = update.in("id", body.ids.map((id: unknown) => Number(id)).filter(Boolean));
      }
      const { error } = await update;
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // Every remaining action targets an existing event.
    const eventId = Number(body.id || body.eventId || 0);
    if (!eventId) return NextResponse.json({ error: "Event is required" }, { status: 400 });
    const event = await getEventOr404(admin, eventId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (action === "update_event") {
      if (!canUpdateEvent(me)) throw new Error("FORBIDDEN");
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.occurredAt !== undefined) {
        const occurredAt = parseDateTimeField(body.occurredAt);
        if (occurredAt === "INVALID" || !occurredAt) {
          return NextResponse.json({ error: "Event date/time is invalid" }, { status: 400 });
        }
        update.occurred_at = occurredAt; changed.push("occurredAt");
      }
      const textMap: [string, string, number][] = [
        ["building", "building", 120], ["unit", "unit", 60], ["area", "area", 120],
        ["equipment", "equipment", 160], ["findings", "findings", 5000],
        ["actionsTaken", "actions_taken", 5000], ["officialWoRef", "official_wo_ref", 120],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) {
          update[column] = textField(body[input], max);
          changed.push(input);
        }
      }
      if (body.description !== undefined) {
        const description = textField(body.description, 5000);
        if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
        update.description = description; changed.push("description");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("log_events").update(update).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "details_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_status") {
      if (!canUpdateEvent(me)) throw new Error("FORBIDDEN");
      const target = String(body.status || "") as LogEventStatus;
      if (!LOG_EVENT_STATUSES.includes(target) || target === "closed") {
        return NextResponse.json({ error: "Use the close action to close an event" }, { status: 400 });
      }
      if (event.status === "closed") {
        return NextResponse.json({ error: "Reopen the event before changing its status" }, { status: 400 });
      }
      if (target === event.status) return NextResponse.json({ ok: true });
      const { error } = await admin.from("log_events")
        .update({ status: target, updated_at: now }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "status_changed", { from: event.status, to: target });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      if (!canUpdateEvent(me)) throw new Error("FORBIDDEN");
      const target = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
      if (target && !(await requireAssignableMember(admin, target))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      if (target === event.responsible_member_id) return NextResponse.json({ ok: true });
      const { error } = await admin.from("log_events")
        .update({ responsible_member_id: target, updated_at: now }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "assigned", {
        fromMemberId: event.responsible_member_id, toMemberId: target,
      });
      await notify(admin, assignmentNotificationRecipients(me.id, target), "log_assigned", event.id, me);
      return NextResponse.json({ ok: true });
    }

    if (action === "set_priority") {
      if (!canUpdateEvent(me)) throw new Error("FORBIDDEN");
      const target = String(body.priority || "") as LogPriority;
      if (!LOG_PRIORITIES.includes(target)) {
        return NextResponse.json({ error: "Choose a valid priority" }, { status: 400 });
      }
      if (target === event.priority) return NextResponse.json({ ok: true });
      const { error } = await admin.from("log_events")
        .update({ priority: target, updated_at: now }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "priority_changed", { from: event.priority, to: target });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_follow_up") {
      if (!canUpdateEvent(me)) throw new Error("FORBIDDEN");
      const target = parseDateField(body.followUpDate);
      if (target === "INVALID") {
        return NextResponse.json({ error: "Follow-up date must use YYYY-MM-DD format" }, { status: 400 });
      }
      if (target === event.follow_up_date) return NextResponse.json({ ok: true });
      const { error } = await admin.from("log_events")
        .update({ follow_up_date: target, updated_at: now }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "follow_up_changed", {
        from: event.follow_up_date, to: target,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "close_event") {
      const finalResult = textField(body.finalResult, 5000);
      if (!canCloseEvent(me, event, finalResult)) {
        return NextResponse.json({
          error: event.status === "closed"
            ? "The event is already closed"
            : "A final result is required to close an event",
        }, { status: 400 });
      }
      const { error } = await admin.from("log_events").update({
        status: "closed", final_result: finalResult,
        closed_by_member_id: me.id, closed_at: now, updated_at: now,
      }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "closed", { finalResult });
      return NextResponse.json({ ok: true });
    }

    if (action === "reopen_event") {
      if (!canReopenEvent(me, event)) {
        return NextResponse.json({ error: "Only a closed event can be reopened" }, { status: 400 });
      }
      const { error } = await admin.from("log_events").update({
        status: "open", final_result: null,
        closed_by_member_id: null, closed_at: null,
        verified_by_member_id: null, verified_at: null,
        updated_at: now,
      }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "reopened", {
        previousFinalResult: event.final_result,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "verify_event") {
      if (!canVerifyEvent(me, event)) {
        return NextResponse.json({
          error: event.status !== "closed"
            ? "Only a closed event can be verified"
            : "The event is already verified",
        }, { status: 400 });
      }
      const { error } = await admin.from("log_events").update({
        verified_by_member_id: me.id, verified_at: now, updated_at: now,
      }).eq("id", event.id);
      if (error) throw error;
      await writeHistory(admin, me, event.id, "verified", {});
      return NextResponse.json({ ok: true });
    }

    if (action === "add_comment") {
      if (!canComment(me)) throw new Error("FORBIDDEN");
      const commentBody = textField(body.body, 5000);
      if (!commentBody) return NextResponse.json({ error: "Comment is required" }, { status: 400 });
      const { data: comment, error } = await admin.from("log_comments").insert({
        event_id: event.id, author_member_id: me.id,
        author_user_id: me.user_id, body: commentBody,
      }).select("*").single<CommentRow>();
      if (error) throw error;
      await writeHistory(admin, me, event.id, "comment_added", { commentId: comment.id });
      await notify(
        admin,
        commentNotificationRecipients(me.id, event),
        "log_comment",
        event.id,
        me,
      );
      return NextResponse.json({ commentId: comment.id });
    }

    if (action === "link_event") {
      if (!canLinkEvents(me)) throw new Error("FORBIDDEN");
      const relatedId = Number(body.relatedEventId || 0);
      if (!relatedId || relatedId === event.id) {
        return NextResponse.json({ error: "Choose a different event to link" }, { status: 400 });
      }
      const relation = LOG_LINK_RELATIONS.includes(body.relation as LogLinkRelation)
        ? (body.relation as LogLinkRelation) : "related";
      const related = await getEventOr404(admin, relatedId);
      if (!related) return NextResponse.json({ error: "Related event not found" }, { status: 404 });
      const { data: existing, error: existingError } = await admin
        .from("log_event_links")
        .select("id")
        .or(`and(event_id.eq.${event.id},related_event_id.eq.${related.id}),and(event_id.eq.${related.id},related_event_id.eq.${event.id})`)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length) {
        return NextResponse.json({ error: "These events are already linked" }, { status: 400 });
      }
      const { error } = await admin.from("log_event_links").insert({
        event_id: event.id, related_event_id: related.id, relation,
        created_by_member_id: me.id,
      });
      if (error) throw error;
      await writeHistory(admin, me, event.id, "linked", {
        relatedEventId: related.id, relatedFolio: related.folio, relation,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
