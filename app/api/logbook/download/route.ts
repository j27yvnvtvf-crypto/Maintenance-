import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember } from "@/lib/access";
import { canDownloadAttachment } from "@/lib/logbook-rules";

/**
 * Logbook attachment download (Phase 2).
 *
 * The "logbook" Storage bucket is private: there is no public URL for any
 * file. This route is the only way bytes leave the bucket:
 *  1. The account is re-checked against the database on THIS request
 *     (a suspended account with an open session is stopped here).
 *  2. Unapproved accounts get 403 before any lookup result is revealed.
 *  3. Any approved account may download event evidence — the logbook is an
 *     operational module with equal permissions for the whole team.
 *  4. Only then does the server mint a signed URL valid for 120 seconds
 *     and redirect the browser to it.
 */

const BUCKET = "logbook";
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
    if (!canDownloadAttachment(me)) throw new Error("APPROVAL_REQUIRED");
    const attachmentId = Number(req.nextUrl.searchParams.get("attachmentId") || 0);
    if (!attachmentId) return NextResponse.json({ error: "Attachment is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: attachment, error: attachmentError } = await admin
      .from("log_attachments")
      .select("id, storage_path, file_name")
      .eq("id", attachmentId)
      .maybeSingle<{ id: number; storage_path: string; file_name: string }>();
    if (attachmentError) throw attachmentError;
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(
      attachment.storage_path,
      SIGNED_URL_SECONDS,
      { download: attachment.file_name },
    );
    if (error) throw error;
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    return failure(error);
  }
}
