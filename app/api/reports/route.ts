import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, type MemberRow } from "@/lib/access";
import {
  canAccessReports,
  canBuildDossier,
  canViewAdminActivity,
  normalizeReportFilters,
} from "@/lib/reports-rules";
import {
  buildCaseDossier,
  buildUnitDossier,
  memberNames,
  searchReports,
} from "@/lib/reports-server";

/**
 * Reports & audit dossiers API (Phase 4).
 *
 * Every permission decision is made HERE, on the server, per request,
 * from the database state — the UI only mirrors them:
 * - Unapproved accounts (pending / rejected / suspended / revoked) get
 *   403 on everything: no search, no dossier, no member list, no admin
 *   activity. There is no read path around the gate.
 * - Every approved account has the SAME operational permissions: filter
 *   across the modules, build case and apartment dossiers and export
 *   CSV (app/api/reports/export). Administration (is_admin) grants
 *   nothing extra in the operational search.
 * - The administrative history (admin_audit_log) is the ONE exception:
 *   it is not operational data, so ?adminActivity=1 additionally
 *   requires the verified administrator. It reads the same table the
 *   Phase 0 Team panel shows — no copy, no second log.
 * - This API is read-only: it never writes to any module table.
 */

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

async function requireReportsMember(): Promise<MemberRow> {
  const me = await getCurrentMember();
  // Per-request state check: a suspended account with an open session is
  // stopped here, exactly like every other data endpoint.
  if (!canAccessReports(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

export async function GET(req: NextRequest) {
  try {
    const me = await requireReportsMember();
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;

    // --- Administrative history: administrator ONLY -------------------
    // Same admin_audit_log the Team panel reads (Phase 0); approved
    // non-administrators are refused even though all operational
    // reports are open to them.
    if (params.get("adminActivity")) {
      if (!canViewAdminActivity(me)) throw new Error("FORBIDDEN");
      const { data, error } = await admin
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      type AuditRow = {
        id: number; action: string; actor_email: string;
        target_email: string | null; detail: Record<string, unknown>;
        created_at: string;
      };
      return NextResponse.json({
        adminActivity: ((data || []) as AuditRow[]).map((row) => ({
          id: row.id,
          action: row.action,
          actorEmail: row.actor_email,
          targetEmail: row.target_email,
          detail: row.detail,
          createdAt: row.created_at,
        })),
      });
    }

    const names = await memberNames(admin);

    // --- Case dossier: one logbook case, fully gathered --------------
    const caseId = Number(params.get("case") || 0);
    if (caseId) {
      if (!canBuildDossier(me)) throw new Error("FORBIDDEN");
      const dossier = await buildCaseDossier(admin, caseId, names);
      if (!dossier) return NextResponse.json({ error: "Case not found" }, { status: 404 });
      return NextResponse.json({ dossier });
    }

    // --- Apartment dossier: everything recorded for one unit ---------
    const unit = (params.get("unit") || "").trim();
    if (unit) {
      if (!canBuildDossier(me)) throw new Error("FORBIDDEN");
      const building = (params.get("building") || "").trim() || null;
      const dossier = await buildUnitDossier(admin, unit.slice(0, 60), building, names);
      return NextResponse.json({ dossier });
    }

    // --- Filtered cross-module search --------------------------------
    const filters = normalizeReportFilters({
      module: params.get("module"),
      from: params.get("from"),
      to: params.get("to"),
      memberId: params.get("memberId"),
      status: params.get("status"),
      building: params.get("building"),
      unit: params.get("unit"),
      q: params.get("q"),
      lowStock: params.get("lowStock"),
    });
    const search = await searchReports(admin, filters, names);

    // The approved team list (id + name only — the same payload every
    // approved account already sees in the Team tab; never the phone).
    const { data: teamRows, error: teamError } = await admin
      .from("members")
      .select("id, name")
      .eq("approval_status", "approved")
      .eq("active", true)
      .order("name", { ascending: true });
    if (teamError) throw teamError;

    return NextResponse.json({
      me: { id: me.id, name: me.name, isAdmin: me.is_admin },
      members: (teamRows || []) as { id: number; name: string }[],
      filters,
      counts: search.counts,
      total: search.total,
      groups: search.groups,
    });
  } catch (error) {
    return failure(error);
  }
}
