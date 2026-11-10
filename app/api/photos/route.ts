import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved, type MemberRow } from "@/lib/access";

/**
 * Unified photo gallery (Phase 5 — Centro de Operaciones, spec §10).
 *
 * GET unions the four module attachment tables (work orders, logbook,
 * inspections, vendors), newest first, and mints a short-lived signed
 * URL per file ON THE SERVER — every bucket is private, and only an
 * approved account ever receives a URL (access model v2, re-checked
 * per request). Filters: module, phase, from, to, q (file name /
 * description) and workOrderId (work-order attachments only).
 *
 * POST multipart uploads a WORK ORDER photo (bucket "jobs"); the other
 * modules keep uploading through their own routes. POST JSON
 * {action:"set_meta"} edits the description / phase classification of
 * an attachment in any of the four tables. Nothing is deleted here.
 */

const SIGNED_URL_SECONDS = 120;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const PHASES = ["before", "during", "after"];

type ModuleKey = "jobs" | "logbook" | "inspections" | "vendors";

const MODULES: Record<ModuleKey, { table: string; bucket: string; recordKey: string }> = {
  jobs: { table: "work_order_attachments", bucket: "jobs", recordKey: "work_order_id" },
  logbook: { table: "log_attachments", bucket: "logbook", recordKey: "event_id" },
  inspections: { table: "inspection_attachments", bucket: "inspections", recordKey: "inspection_id" },
  vendors: { table: "vendor_attachments", bucket: "vendors", recordKey: "vendor_job_id" },
};

type AttachmentRow = {
  id: number; storage_path: string; file_name: string;
  description: string | null; phase: string | null;
  uploaded_by_member_id: number | null; created_at: string;
  [key: string]: unknown;
};

type GalleryItem = {
  id: number; module: ModuleKey; recordId: number | null;
  fileName: string; description: string | null; phase: string | null;
  createdAt: string; uploadedByName: string | null; signedUrl: string | null;
  storagePath: string; bucket: string;
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

function sanitizeFileName(name: string) {
  const clean = name.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120);
  return clean || "file";
}

export async function GET(req: NextRequest) {
  try {
    await requireApproved();
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;
    const moduleParam = (params.get("module") || "").trim() as ModuleKey;
    const phase = (params.get("phase") || "").trim();
    const from = (params.get("from") || "").trim();
    const to = (params.get("to") || "").trim();
    const q = (params.get("q") || "").trim().toLowerCase();
    const workOrderId = Number(params.get("workOrderId") || 0);

    const { data: memberRows, error: memberError } = await admin.from("members").select("id, name");
    if (memberError) throw memberError;
    const names = new Map(
      ((memberRows || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]),
    );

    const moduleKeys = (Object.keys(MODULES) as ModuleKey[])
      .filter((key) => !moduleParam || moduleParam === key)
      .filter((key) => !(workOrderId && key !== "jobs"));

    const items: GalleryItem[] = [];
    for (const key of moduleKeys) {
      const config = MODULES[key];
      let query = admin.from(config.table).select("*")
        .order("created_at", { ascending: false }).limit(200);
      if (key === "jobs" && workOrderId) query = query.eq("work_order_id", workOrderId);
      if (phase && PHASES.includes(phase)) query = query.eq("phase", phase);
      const { data, error } = await query;
      if (error) throw error;
      for (const row of (data || []) as AttachmentRow[]) {
        const day = String(row.created_at || "").slice(0, 10);
        if (from && day < from) continue;
        if (to && day > to) continue;
        if (q && !`${row.file_name} ${row.description || ""}`.toLowerCase().includes(q)) continue;
        items.push({
          id: row.id,
          module: key,
          recordId: typeof row[config.recordKey] === "number" ? (row[config.recordKey] as number) : null,
          fileName: row.file_name,
          description: row.description ?? null,
          phase: row.phase ?? null,
          createdAt: row.created_at,
          uploadedByName: row.uploaded_by_member_id ? names.get(row.uploaded_by_member_id) || null : null,
          signedUrl: null,
          storagePath: row.storage_path,
          bucket: config.bucket,
        });
      }
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const top = items.slice(0, 200);

    // Signed URLs are minted in bulk per bucket, only for approved eyes.
    const byBucket = new Map<string, GalleryItem[]>();
    for (const item of top) {
      byBucket.set(item.bucket, [...(byBucket.get(item.bucket) || []), item]);
    }
    for (const [bucket, bucketItems] of byBucket) {
      const { data: signed, error } = await admin.storage
        .from(bucket)
        .createSignedUrls(bucketItems.map((item) => item.storagePath), SIGNED_URL_SECONDS);
      if (error) throw error;
      (signed || []).forEach((entry, index) => {
        bucketItems[index].signedUrl = entry.signedUrl || null;
      });
    }

    const mapped = top.map((item) => ({
      id: item.id,
      module: item.module,
      recordId: item.recordId,
      workOrderId: item.module === "jobs" ? item.recordId : null,
      fileName: item.fileName,
      description: item.description,
      phase: item.phase,
      createdAt: item.createdAt,
      uploadedByName: item.uploadedByName,
      signedUrl: item.signedUrl,
    }));
    // `photos` is the gallery key the panels read; `items` is kept as an
    // alias of the same array for API consumers.
    return NextResponse.json({ photos: mapped, items: mapped });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireApproved();
    const admin = createAdminClient();
    const contentType = req.headers.get("content-type") || "";

    // --- Multipart: upload a work order photo (bucket "jobs") ---
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const moduleKey = String(form.get("module") || "jobs");
      if (moduleKey !== "jobs") {
        return NextResponse.json(
          { error: "Photo uploads here are for work orders; other modules upload in their own panel" },
          { status: 400 },
        );
      }
      const workOrderId = Number(form.get("workOrderId") || 0);
      if (!workOrderId) return NextResponse.json({ error: "Work order is required" }, { status: 400 });
      const { data: job, error: jobError } = await admin
        .from("work_orders").select("id").eq("id", workOrderId).maybeSingle();
      if (jobError) throw jobError;
      if (!job) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "A file is required" }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "The file is larger than 25 MB" }, { status: 400 });
      }
      const phaseRaw = String(form.get("phase") || "").trim();
      const phase = PHASES.includes(phaseRaw) ? phaseRaw : null;
      const description = String(form.get("description") || "").trim().slice(0, 1000) || null;
      const storagePath = `${workOrderId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const buffer = await file.arrayBuffer();
      const { error: uploadError } = await admin.storage.from("jobs").upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: attachment, error: insertError } = await admin
        .from("work_order_attachments")
        .insert({
          work_order_id: workOrderId,
          storage_path: storagePath,
          file_name: file.name,
          content_type: file.type || null,
          file_size: file.size,
          description,
          phase,
          uploaded_by_member_id: me.id,
          uploaded_by_user_id: me.user_id,
        })
        .select("id")
        .single<{ id: number }>();
      if (insertError) {
        await admin.storage.from("jobs").remove([storagePath]);
        throw insertError;
      }
      const { error: historyError } = await admin.from("work_order_history").insert({
        work_order_id: workOrderId,
        actor_member_id: me.id,
        actor_user_id: me.user_id,
        actor_email: me.email,
        action: "attachment_added",
        detail: { attachmentId: attachment.id, fileName: file.name, phase },
      });
      if (historyError) throw historyError;
      return NextResponse.json({ attachmentId: attachment.id });
    }

    // --- JSON: classify an attachment of any module ---
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (String(body.action || "") !== "set_meta") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const moduleKey = String(body.module || "") as ModuleKey;
    const config = MODULES[moduleKey];
    if (!config) return NextResponse.json({ error: "Choose a valid module" }, { status: 400 });
    const attachmentId = Number(body.attachmentId || 0);
    if (!attachmentId) return NextResponse.json({ error: "Attachment is required" }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (body.description !== undefined) {
      update.description = String(body.description ?? "").trim().slice(0, 1000) || null;
    }
    if (body.phase !== undefined) {
      const phase = String(body.phase || "").trim();
      if (phase && !PHASES.includes(phase)) {
        return NextResponse.json({ error: "Phase must be before, during or after" }, { status: 400 });
      }
      update.phase = phase || null;
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const { data: existing, error: findError } = await admin
      .from(config.table).select("id").eq("id", attachmentId).maybeSingle();
    if (findError) throw findError;
    if (!existing) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const { error } = await admin.from(config.table).update(update).eq("id", attachmentId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
