import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isAdmin, isApproved, type MemberRow } from "@/lib/access";
import {
  canConfirmRead, canManageDocuments, canViewDocument,
  DOCUMENT_CATEGORIES, DOCUMENT_TYPES,
  type DocumentCategory, type DocumentStatus, type DocumentType,
} from "@/lib/library-rules";

/**
 * Document library API (Phase 1).
 *
 * Every permission decision is made HERE, on the server, per request, from
 * the database state — the UI only mirrors them:
 * - Unapproved accounts (pending / rejected / suspended / revoked) get 403
 *   on everything: no list, no detail, no download, no read confirmation.
 * - Approved accounts see and download PUBLISHED documents only.
 * - Draft and archived documents, read evidence about other people, and all
 *   management actions (create / edit / publish / archive / new version)
 *   are administrator-only (is_admin). Management actions are written to
 *   the Phase 0 admin_audit_log.
 * - Files live in the private "documents" Storage bucket. Bytes are never
 *   served by this route; downloads go through the signed-URL route after
 *   the same checks (app/api/library/download).
 */

const BUCKET = "documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md",
]);

type DocumentRow = {
  id: number; category: DocumentCategory; doc_type: DocumentType; title: string;
  sop_number: string | null; owner_member_id: number | null;
  status: DocumentStatus; created_by: string | null;
  created_at: string; updated_at: string;
};

type VersionRow = {
  id: number; document_id: number; version_number: number;
  effective_date: string | null; change_note: string | null;
  storage_path: string; file_name: string; content_type: string | null;
  file_size: number | null; uploaded_by: string | null;
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

/** Document administration joins the Phase 0 administrative audit trail. */
async function writeDocAudit(
  admin: AdminClient,
  actor: MemberRow,
  action: "create_document" | "update_document" | "publish_document" | "archive_document" | "add_document_version",
  document: DocumentRow,
  detail: Record<string, unknown>,
) {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_user_id: actor.user_id,
    actor_member_id: actor.id,
    actor_email: actor.email,
    action,
    target_member_id: null,
    target_email: null,
    detail: { documentId: document.id, title: document.title, ...detail },
  });
  if (error) throw error;
}

function versionForClient(version: VersionRow) {
  return {
    id: version.id,
    versionNumber: version.version_number,
    effectiveDate: version.effective_date,
    changeNote: version.change_note,
    fileName: version.file_name,
    contentType: version.content_type,
    fileSize: version.file_size,
    createdAt: version.created_at,
  };
}

function documentForClient(
  doc: DocumentRow,
  names: Map<number, string>,
  current: VersionRow | null,
  versionCount: number,
  myReadAt: string | null,
) {
  return {
    id: doc.id,
    category: doc.category,
    docType: doc.doc_type,
    title: doc.title,
    sopNumber: doc.sop_number,
    status: doc.status,
    ownerMemberId: doc.owner_member_id,
    ownerName: doc.owner_member_id ? names.get(doc.owner_member_id) || null : null,
    currentVersion: current ? versionForClient(current) : null,
    versionCount,
    myReadAt,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

async function requireOperationalMember() {
  const me = await getCurrentMember();
  // Per-request state check: a suspended account with an open session is
  // stopped here, exactly like every other data endpoint.
  if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

export async function GET(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const detailId = Number(req.nextUrl.searchParams.get("id") || 0);

    const { data: memberRows, error: memberError } = await admin
      .from("members")
      .select("id, name, email, approval_status, active");
    if (memberError) throw memberError;
    type MemberLite = { id: number; name: string; email: string; approval_status: string; active: boolean };
    const members = (memberRows || []) as MemberLite[];
    const names = new Map(members.map((person) => [person.id, person.name]));

    if (detailId) {
      const { data: docData, error: docError } = await admin
        .from("documents").select("*").eq("id", detailId).maybeSingle<DocumentRow>();
      if (docError) throw docError;
      if (!docData) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      if (!canViewDocument(me, docData)) throw new Error("FORBIDDEN");
      const { data: versionRows, error: versionError } = await admin
        .from("document_versions").select("*")
        .eq("document_id", docData.id)
        .order("version_number", { ascending: false });
      if (versionError) throw versionError;
      const versions = (versionRows || []) as VersionRow[];
      const { data: readRows, error: readError } = await admin
        .from("document_reads").select("version_id, member_id, read_at")
        .in("version_id", versions.map((version) => version.id));
      if (readError) throw readError;
      type ReadRow = { version_id: number; member_id: number; read_at: string };
      const reads = (readRows || []) as ReadRow[];
      const approvedMembers = members.filter(
        (person) => person.active && person.approval_status === "approved",
      );
      const versionsForClient = versions.map((version) => {
        const versionReads = reads.filter((read) => read.version_id === version.id);
        const myRead = versionReads.find((read) => read.member_id === me.id);
        const base = {
          ...versionForClient(version),
          myReadAt: myRead ? myRead.read_at : null,
        };
        if (!isAdmin(me)) return base;
        // Read evidence about other people is administrator-only.
        const readByIds = new Set(versionReads.map((read) => read.member_id));
        return {
          ...base,
          reads: versionReads.map((read) => ({
            memberId: read.member_id,
            memberName: names.get(read.member_id) || null,
            readAt: read.read_at,
          })),
          notRead: approvedMembers
            .filter((person) => !readByIds.has(person.id))
            .map((person) => ({ memberId: person.id, memberName: person.name })),
        };
      });
      const current = versions[0] || null;
      const myCurrentRead = current
        ? reads.find((read) => read.version_id === current.id && read.member_id === me.id)
        : undefined;
      return NextResponse.json({
        isAdmin: isAdmin(me),
        document: documentForClient(docData, names, current, versions.length, myCurrentRead ? myCurrentRead.read_at : null),
        versions: versionsForClient,
      });
    }

    const { data: docRows, error: docError } = await admin
      .from("documents").select("*").order("title");
    if (docError) throw docError;
    // Draft and archived documents are invisible to non-administrators,
    // including their very existence in this list.
    const visibleDocs = ((docRows || []) as DocumentRow[]).filter((doc) => canViewDocument(me, doc));
    const docIds = visibleDocs.map((doc) => doc.id);
    const { data: versionRows, error: versionError } = await admin
      .from("document_versions").select("*")
      .in("document_id", docIds.length ? docIds : [-1])
      .order("version_number", { ascending: false });
    if (versionError) throw versionError;
    const versions = (versionRows || []) as VersionRow[];
    const { data: myReads, error: readError } = await admin
      .from("document_reads").select("version_id, read_at")
      .eq("member_id", me.id)
      .in("version_id", versions.map((version) => version.id));
    if (readError) throw readError;
    const myReadByVersion = new Map(
      ((myReads || []) as { version_id: number; read_at: string }[]).map((read) => [read.version_id, read.read_at]),
    );
    const documents = visibleDocs.map((doc) => {
      const docVersions = versions.filter((version) => version.document_id === doc.id);
      const current = docVersions[0] || null;
      return documentForClient(
        doc, names, current, docVersions.length,
        current ? myReadByVersion.get(current.id) || null : null,
      );
    });
    return NextResponse.json({ isAdmin: isAdmin(me), documents });
  } catch (error) {
    return failure(error);
  }
}

function sanitizeFileName(name: string) {
  const clean = name.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120);
  return clean || "document";
}

function validateFile(file: File) {
  if (file.size === 0) return "The file is empty";
  if (file.size > MAX_FILE_BYTES) return "The file is larger than 25 MB";
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return "File type not allowed";
  return null;
}

function parseDateField(value: FormDataEntryValue | string | null) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const contentType = req.headers.get("content-type") || "";

    // --- Multipart actions: file uploads (administrator only) ---
    if (contentType.includes("multipart/form-data")) {
      if (!canManageDocuments(me)) throw new Error("FORBIDDEN");
      const form = await req.formData();
      const action = String(form.get("action") || "");
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required" }, { status: 400 });
      }
      const fileError = validateFile(file);
      if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
      const effectiveDate = parseDateField(form.get("effectiveDate"));
      if (effectiveDate === "INVALID") {
        return NextResponse.json({ error: "Effective date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const changeNote = String(form.get("changeNote") || "").trim().slice(0, 1000) || null;

      if (action === "create_document") {
        const category = String(form.get("category") || "");
        const docType = String(form.get("docType") || "internal_guide");
        const title = String(form.get("title") || "").trim();
        if (!DOCUMENT_CATEGORIES.includes(category as DocumentCategory)) {
          return NextResponse.json({ error: "Choose a valid category" }, { status: 400 });
        }
        if (!DOCUMENT_TYPES.includes(docType as DocumentType)) {
          return NextResponse.json({ error: "Choose a valid document type" }, { status: 400 });
        }
        if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        const sopNumber = String(form.get("sopNumber") || "").trim().slice(0, 60) || null;
        const ownerMemberId = form.get("ownerMemberId") ? Number(form.get("ownerMemberId")) : null;
        const publish = String(form.get("publish") || "") === "true";

        const { data: created, error: createError } = await admin.from("documents").insert({
          category, doc_type: docType, title, sop_number: sopNumber,
          owner_member_id: ownerMemberId, status: "draft", created_by: me.user_id,
        }).select("*").single<DocumentRow>();
        if (createError) throw createError;
        const doc = created;
        const storagePath = `${doc.id}/v1/${sanitizeFileName(file.name)}`;
        const buffer = await file.arrayBuffer();
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (uploadError) {
          // Leave no orphan: the document row stays as an empty draft only
          // if removing it fails; the error is reported either way.
          await admin.from("documents").delete().eq("id", doc.id);
          throw uploadError;
        }
        const { error: versionError } = await admin.from("document_versions").insert({
          document_id: doc.id, version_number: 1, effective_date: effectiveDate,
          change_note: changeNote, storage_path: storagePath, file_name: file.name,
          content_type: file.type || null, file_size: file.size,
          uploaded_by: me.user_id, uploaded_by_member_id: me.id,
        });
        if (versionError) {
          await admin.storage.from(BUCKET).remove([storagePath]);
          await admin.from("documents").delete().eq("id", doc.id);
          throw versionError;
        }
        if (publish) {
          const { error: publishError } = await admin.from("documents")
            .update({ status: "published", updated_at: new Date().toISOString() }).eq("id", doc.id);
          if (publishError) throw publishError;
          doc.status = "published";
        }
        await writeDocAudit(admin, me, "create_document", doc, {
          category, docType, published: publish,
        });
        return NextResponse.json({ documentId: doc.id });
      }

      if (action === "add_version") {
        const documentId = Number(form.get("documentId") || 0);
        if (!documentId) return NextResponse.json({ error: "Document is required" }, { status: 400 });
        const { data: docData, error: docError } = await admin
          .from("documents").select("*").eq("id", documentId).maybeSingle<DocumentRow>();
        if (docError) throw docError;
        if (!docData) return NextResponse.json({ error: "Document not found" }, { status: 404 });
        const { data: lastVersion, error: lastError } = await admin
          .from("document_versions").select("version_number")
          .eq("document_id", docData.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle<{ version_number: number }>();
        if (lastError) throw lastError;
        const nextNumber = (lastVersion?.version_number || 0) + 1;
        const storagePath = `${docData.id}/v${nextNumber}/${sanitizeFileName(file.name)}`;
        const buffer = await file.arrayBuffer();
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const { error: versionError } = await admin.from("document_versions").insert({
          document_id: docData.id, version_number: nextNumber, effective_date: effectiveDate,
          change_note: changeNote, storage_path: storagePath, file_name: file.name,
          content_type: file.type || null, file_size: file.size,
          uploaded_by: me.user_id, uploaded_by_member_id: me.id,
        });
        if (versionError) {
          await admin.storage.from(BUCKET).remove([storagePath]);
          throw versionError;
        }
        // The previous version's row and file are untouched: history is
        // append-only, never overwritten.
        await writeDocAudit(admin, me, "add_document_version", docData, { versionNumber: nextNumber });
        return NextResponse.json({ documentId: docData.id, versionNumber: nextNumber });
      }

      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // --- JSON actions ---
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (body.action === "confirm_read") {
      const versionId = Number(body.versionId);
      if (!versionId) return NextResponse.json({ error: "Version is required" }, { status: 400 });
      const { data: versionData, error: versionError } = await admin
        .from("document_versions").select("*").eq("id", versionId).maybeSingle<VersionRow>();
      if (versionError) throw versionError;
      if (!versionData) return NextResponse.json({ error: "Version not found" }, { status: 404 });
      const { data: docData, error: docError } = await admin
        .from("documents").select("*").eq("id", versionData.document_id).maybeSingle<DocumentRow>();
      if (docError) throw docError;
      if (!docData) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      if (!canConfirmRead(me, docData)) throw new Error("FORBIDDEN");
      // Upsert keeps the FIRST confirmation time: re-confirming never
      // rewrites the evidence.
      const { error } = await admin.from("document_reads").upsert(
        { version_id: versionData.id, member_id: me.id, user_id: me.user_id, read_at: new Date().toISOString() },
        { onConflict: "version_id,member_id", ignoreDuplicates: true },
      );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const managementActions = ["publish_document", "archive_document", "update_document"];
    if (managementActions.includes(String(body.action))) {
      if (!canManageDocuments(me)) throw new Error("FORBIDDEN");
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Document is required" }, { status: 400 });
      const { data: docData, error: docError } = await admin
        .from("documents").select("*").eq("id", id).maybeSingle<DocumentRow>();
      if (docError) throw docError;
      if (!docData) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      const now = new Date().toISOString();

      if (body.action === "publish_document") {
        const { count, error: countError } = await admin
          .from("document_versions").select("id", { count: "exact", head: true })
          .eq("document_id", docData.id);
        if (countError) throw countError;
        if (!count) return NextResponse.json({ error: "Upload a file before publishing" }, { status: 400 });
        const { error } = await admin.from("documents")
          .update({ status: "published", updated_at: now }).eq("id", docData.id);
        if (error) throw error;
        await writeDocAudit(admin, me, "publish_document", docData, { fromStatus: docData.status });
        return NextResponse.json({ ok: true });
      }
      if (body.action === "archive_document") {
        const { error } = await admin.from("documents")
          .update({ status: "archived", updated_at: now }).eq("id", docData.id);
        if (error) throw error;
        await writeDocAudit(admin, me, "archive_document", docData, { fromStatus: docData.status });
        return NextResponse.json({ ok: true });
      }
      // update_document: metadata only. Status changes go through the
      // dedicated publish/archive actions so they are audited as such.
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.title !== undefined) {
        const title = String(body.title || "").trim();
        if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        update.title = title; changed.push("title");
      }
      if (body.category !== undefined) {
        if (!DOCUMENT_CATEGORIES.includes(body.category as DocumentCategory)) {
          return NextResponse.json({ error: "Choose a valid category" }, { status: 400 });
        }
        update.category = body.category; changed.push("category");
      }
      if (body.docType !== undefined) {
        if (!DOCUMENT_TYPES.includes(body.docType as DocumentType)) {
          return NextResponse.json({ error: "Choose a valid document type" }, { status: 400 });
        }
        update.doc_type = body.docType; changed.push("docType");
      }
      if (body.sopNumber !== undefined) {
        update.sop_number = String(body.sopNumber || "").trim().slice(0, 60) || null;
        changed.push("sopNumber");
      }
      if (body.ownerMemberId !== undefined) {
        update.owner_member_id = body.ownerMemberId ? Number(body.ownerMemberId) : null;
        changed.push("ownerMemberId");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("documents").update(update).eq("id", docData.id);
      if (error) throw error;
      await writeDocAudit(admin, me, "update_document", docData, { changed });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
