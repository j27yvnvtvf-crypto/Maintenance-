import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved } from "@/lib/access";
import { canDownloadVersion } from "@/lib/library-rules";

/**
 * Document download (Phase 1).
 *
 * The "documents" Storage bucket is private: there is no public URL for any
 * file. This route is the only way bytes leave the bucket:
 *  1. The account is re-checked against the database on THIS request
 *     (a suspended account with an open session is stopped here).
 *  2. Unapproved accounts get 403 before any lookup result is revealed.
 *  3. Approved accounts may download versions of PUBLISHED documents only;
 *     draft and archived files are administrator-only.
 *  4. Only then does the server mint a signed URL valid for 120 seconds
 *     and redirect the browser to it.
 */

const BUCKET = "documents";
const SIGNED_URL_SECONDS = 120;

function failure(error: unknown) {
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

export async function GET(req: NextRequest) {
  try {
    const me = await getCurrentMember();
    if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");
    const versionId = Number(req.nextUrl.searchParams.get("versionId") || 0);
    if (!versionId) return NextResponse.json({ error: "Version is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: version, error: versionError } = await admin
      .from("document_versions")
      .select("id, document_id, storage_path, file_name")
      .eq("id", versionId)
      .maybeSingle<{ id: number; document_id: number; storage_path: string; file_name: string }>();
    if (versionError) throw versionError;
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    const { data: doc, error: docError } = await admin
      .from("documents")
      .select("id, status")
      .eq("id", version.document_id)
      .maybeSingle<{ id: number; status: "draft" | "published" | "archived" }>();
    if (docError) throw docError;
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!canDownloadVersion(me, doc)) throw new Error("FORBIDDEN");
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(
      version.storage_path,
      SIGNED_URL_SECONDS,
      { download: version.file_name },
    );
    if (error) throw error;
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    return failure(error);
  }
}
