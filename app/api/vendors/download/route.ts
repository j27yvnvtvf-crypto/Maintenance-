import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember } from "@/lib/access";
import { canDownloadVendorAttachment } from "@/lib/inventory-vendors-rules";

/*
 * Vendor attachment downloads (Phase 3B).
 *
 * The "vendors" bucket is private and there are no public URLs. Every
 * download re-checks the caller on THIS request — approved + active members
 * only; pending / rejected / suspended / revoked accounts get 403 — then the
 * server redirects to a signed URL that lives for 120 seconds. This endpoint
 * is never linked without the check, and the storage path comes from our own
 * database row, never from the client.
 */

export async function GET(req: NextRequest) {
  try {
    const me = await getCurrentMember();
    if (!me || !canDownloadVendorAttachment(me)) {
      return NextResponse.json({ error: "Account not approved" }, { status: 403 });
    }

    const attachmentId = Number(req.nextUrl.searchParams.get("attachmentId") || 0);
    if (!attachmentId) {
      return NextResponse.json({ error: "attachmentId is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: attachment, error } = await admin
      .from("vendor_attachments")
      .select("id, storage_path")
      .eq("id", attachmentId)
      .maybeSingle<{ id: number; storage_path: string }>();
    if (error) throw error;
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const { data: signed, error: signError } = await admin.storage
      .from("vendors")
      .createSignedUrl(attachment.storage_path, 120);
    if (signError || !signed?.signedUrl) {
      return NextResponse.json({ error: "Could not sign the download URL" }, { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
