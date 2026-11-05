import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember } from "@/lib/access";
import {
  buildCsv,
  canExportReports,
  normalizeReportFilters,
  REPORT_MODULES,
  type ReportModule,
} from "@/lib/reports-rules";
import { fetchCsvRows, memberNames } from "@/lib/reports-server";

/**
 * CSV export for reports (Phase 4).
 *
 * The CSV is generated ON THE SERVER from the same filtered queries the
 * reports search uses — the client never assembles data exports itself.
 * The gate is identical to every other property datum: an unapproved
 * account (pending / rejected / suspended / revoked) receives 403 here
 * too, with no partial file. One module per file, because each module
 * has its own declared column set (lib/reports-rules.ts CSV_COLUMNS).
 */

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
    if (!canExportReports(me)) throw new Error("APPROVAL_REQUIRED");
    const params = req.nextUrl.searchParams;
    const moduleParam = (params.get("module") || "").trim();
    if (!(REPORT_MODULES as readonly string[]).includes(moduleParam)) {
      return NextResponse.json(
        { error: "Choose exactly one module to export" },
        { status: 400 },
      );
    }
    const moduleKey = moduleParam as ReportModule;
    const filters = normalizeReportFilters({
      module: moduleKey,
      from: params.get("from"),
      to: params.get("to"),
      memberId: params.get("memberId"),
      status: params.get("status"),
      building: params.get("building"),
      unit: params.get("unit"),
      q: params.get("q"),
      lowStock: params.get("lowStock"),
    });
    const admin = createAdminClient();
    const names = await memberNames(admin);
    const rows = await fetchCsvRows(admin, moduleKey, filters, names);
    const csv = buildCsv(moduleKey, rows);
    const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return new NextResponse("\uFEFF" + csv, { // BOM so Excel reads accents correctly
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="the-darley-${moduleKey}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
