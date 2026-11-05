/**
 * Phase 3A verification — inspections, preventive maintenance and the
 * shop closing record.
 *
 *   node --test scripts/verify-inspections.mjs
 *
 * Two layers, same split as the earlier phases:
 *
 * 1. DECISION TESTS run the real lib/inspections-rules.ts (the exact
 *    functions the API calls) against fixture members, inspections,
 *    results and corrective actions:
 *      - permission matrix: unapproved accounts can do nothing;
 *        approved accounts execute inspections with equal permissions;
 *        ONLY is_admin manages templates (a job_title of "Admin"
 *        grants nothing — cross-checked against lib/access-rules.ts);
 *      - a finding result (pending / in progress / waiting on vendor)
 *        — and only a finding — can generate a corrective action;
 *      - a corrective action closes through completed → verified, with
 *        the verification recorded (verified_by set blocks a second
 *        verification);
 *      - an inspection completes only when every REQUIRED item is
 *        answered; optional items never block; overdue is computed at
 *        read time from the stored date, never stored as a flag;
 *      - frequencies are configuration data (daily/weekly/monthly/
 *        quarterly/annual/custom/none): the system imposes no
 *        "official" frequency — the migration defaults frequency_type
 *        to 'none' and no rule maps a frequency to a schedule.
 *
 * 2. STATIC CONTRACTS read the migration, the API routes, the print
 *    page and the dashboard to prove the server-side properties the
 *    rules assume: re-checks the member on every request, enforces
 *    admin-only template management, private bucket with 120-second
 *    signed downloads, append-only history (no deletes), NO seeded
 *    templates (the system ships empty — real The Darley checklists
 *    are defined by the administrator, never invented), one shop
 *    closing record per day, and the print format reading the real
 *    record.
 *
 * What this suite is NOT: an end-to-end HTTP test against a live
 * Supabase. That run (real accounts on the staging project: admin
 * publishes a template, approved member executes it and closes a
 * corrective action, pending account gets 403) is still pending —
 * staging deployment is tracked separately and reported honestly in
 * the phase PR.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const rules = await import("../lib/inspections-rules.ts");
const access = await import("../lib/access-rules.ts");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const member = (over = {}) => ({
  active: true, approval_status: "approved", is_admin: false, ...over,
});
const pending = member({ approval_status: "pending" });
const admin = member({ is_admin: true });
const titledAdmin = member({ job_title: "Admin" }); // free text: grants nothing

const inspection = (over = {}) => ({
  status: "in_progress", scheduled_date: "2026-01-01", ...over,
});
const result = (over = {}) => ({
  required: true, status: "no_issue", answer: null, ...over,
});
const corrective = (over = {}) => ({
  status: "open", verified_by_member_id: null, due_date: null, ...over,
});

/* ------------------------------------------------------------------ */
/* 1. Decision tests                                                   */
/* ------------------------------------------------------------------ */

test("permission matrix: unapproved accounts can do nothing anywhere", () => {
  for (const status of ["unregistered", "pending", "rejected", "suspended", "revoked"]) {
    const m = member({ approval_status: status });
    assert.equal(rules.isInspectionOperational(m), false, status);
    assert.equal(rules.canAccessInspections(m), false, status);
    assert.equal(rules.canExecuteInspection(m), false, status);
    assert.equal(rules.canManageTemplates(m), false, status);
    assert.equal(rules.canDownloadInspectionAttachment(m), false, status);
    assert.equal(rules.canCreateCorrectiveAction(m, result({ status: "pending" })), false, status);
  }
  const inactive = member({ active: false });
  assert.equal(rules.isInspectionOperational(inactive), false);
  assert.equal(rules.canAccessInspections(null), false);
  assert.equal(rules.canManageTemplates(undefined), false);
});

test("permission matrix: inspections module agrees with the Phase 0 access model", () => {
  for (const approval_status of ["unregistered", "pending", "approved", "rejected", "suspended", "revoked"]) {
    for (const active of [true, false]) {
      for (const is_admin of [true, false]) {
        const m = member({ approval_status, active, is_admin });
        assert.equal(rules.isInspectionOperational(m), access.isApprovedAccess(m));
        assert.equal(rules.isInspectionAdmin(m), access.isAdminAccess(m));
      }
    }
  }
});

test("approved accounts execute; only the real admin manages templates", () => {
  const approved = member();
  assert.equal(rules.canExecuteInspection(approved), true);
  assert.equal(rules.canManageTemplates(approved), false);
  assert.equal(rules.canManageTemplates(admin), true);
  // job_title "Admin" is free text and must grant nothing.
  assert.equal(rules.canManageTemplates(titledAdmin), false);
  assert.equal(rules.isInspectionAdmin(titledAdmin), false);
  // An admin flag on an UNAPPROVED account grants nothing either.
  assert.equal(rules.canManageTemplates(member({ approval_status: "pending", is_admin: true })), false);
});

test("template visibility: published for the team, draft/archived admin-only", () => {
  assert.equal(rules.canViewTemplate(member(), { status: "published" }), true);
  assert.equal(rules.canViewTemplate(member(), { status: "draft" }), false);
  assert.equal(rules.canViewTemplate(member(), { status: "archived" }), false);
  assert.equal(rules.canViewTemplate(admin, { status: "draft" }), true);
  assert.equal(rules.canViewTemplate(admin, { status: "archived" }), true);
  assert.equal(rules.canViewTemplate(pending, { status: "published" }), false);
  // Starting an inspection requires a PUBLISHED template — even for admin.
  assert.equal(rules.canStartFromTemplate(member(), { status: "published" }), true);
  assert.equal(rules.canStartFromTemplate(admin, { status: "draft" }), false);
  assert.equal(rules.canStartFromTemplate(member(), { status: "archived" }), false);
});

test("finding detection: only problem states are findings", () => {
  for (const status of ["pending", "in_progress", "waiting_vendor"]) {
    assert.equal(rules.isFindingResult(result({ status })), true, status);
  }
  for (const status of ["no_issue", "completed", "na", null]) {
    assert.equal(rules.isFindingResult(result({ status })), false, String(status));
  }
});

test("a finding generates a corrective action; a clean item cannot", () => {
  assert.equal(rules.canCreateCorrectiveAction(member(), result({ status: "pending" })), true);
  assert.equal(rules.canCreateCorrectiveAction(member(), result({ status: "waiting_vendor" })), true);
  assert.equal(rules.canCreateCorrectiveAction(admin, result({ status: "in_progress" })), true);
  assert.equal(rules.canCreateCorrectiveAction(member(), result({ status: "no_issue" })), false);
  assert.equal(rules.canCreateCorrectiveAction(member(), result({ status: null })), false);
  assert.equal(rules.canCreateCorrectiveAction(pending, result({ status: "pending" })), false);
});

test("corrective action lifecycle: open → completed → verified, verification recorded once", () => {
  assert.equal(rules.canCompleteCorrectiveAction(member(), corrective({ status: "open" })), true);
  assert.equal(rules.canCompleteCorrectiveAction(member(), corrective({ status: "in_progress" })), true);
  assert.equal(rules.canCompleteCorrectiveAction(member(), corrective({ status: "completed" })), false);
  assert.equal(rules.canUpdateCorrectiveAction(member(), corrective({ status: "open" })), true);
  assert.equal(rules.canUpdateCorrectiveAction(member(), corrective({ status: "verified" })), false);
  // Verification requires the completed state...
  assert.equal(rules.canVerifyCorrectiveAction(member(), corrective({ status: "open" })), false);
  assert.equal(rules.canVerifyCorrectiveAction(member(), corrective({ status: "completed", verified_by_member_id: null })), true);
  // ...and a recorded verifier (verified_by set) blocks a second one.
  assert.equal(rules.canVerifyCorrectiveAction(member(), corrective({ status: "completed", verified_by_member_id: 7 })), false);
  assert.equal(rules.canVerifyCorrectiveAction(member(), corrective({ status: "verified", verified_by_member_id: 7 })), false);
});

test("completing an inspection requires every REQUIRED item answered", () => {
  const ready = [result({ required: true, status: "no_issue" }), result({ required: false, status: null })];
  assert.equal(rules.canCompleteInspection(member(), inspection(), ready), true);
  const blocked = [result({ required: true, status: null, answer: null })];
  assert.equal(rules.canCompleteInspection(member(), inspection(), blocked), false);
  // A yes/no item answered with only an answer counts as answered.
  const yesNo = [result({ required: true, status: null, answer: "yes" })];
  assert.equal(rules.canCompleteInspection(member(), inspection(), yesNo), true);
  // N/A is an answer (Jose's rule: applicable items carry the N/A option).
  const na = [result({ required: true, status: "na" })];
  assert.equal(rules.canCompleteInspection(member(), inspection(), na), true);
  // Completed inspections cannot be completed again; results lock.
  assert.equal(rules.canCompleteInspection(member(), inspection({ status: "completed" }), ready), false);
  assert.equal(rules.canRecordResult(member(), inspection({ status: "completed" })), false);
  assert.equal(rules.canRecordResult(member(), inspection()), true);
  assert.equal(rules.canReopenInspection(member(), inspection({ status: "completed" })), true);
  assert.equal(rules.canReopenInspection(member(), inspection()), false);
});

test("overdue is computed at read time, never stored", () => {
  const today = "2026-06-01";
  assert.equal(rules.isInspectionOverdue(inspection({ scheduled_date: "2026-05-31" }), today), true);
  assert.equal(rules.isInspectionOverdue(inspection({ scheduled_date: today }), today), false);
  assert.equal(rules.isInspectionOverdue(inspection({ scheduled_date: "2026-05-31", status: "completed" }), today), false);
  assert.equal(rules.isInspectionOverdue(inspection({ scheduled_date: null }), today), false);
  assert.equal(rules.isCorrectiveOverdue(corrective({ due_date: "2026-05-31", status: "open" }), today), true);
  assert.equal(rules.isCorrectiveOverdue(corrective({ due_date: "2026-05-31", status: "completed" }), today), false);
  assert.equal(rules.isCorrectiveOverdue(corrective({ due_date: "2026-05-31", status: "verified" }), today), false);
});

test("frequencies are configuration, never an imposed official schedule", () => {
  assert.deepEqual(
    [...rules.FREQUENCY_TYPES].sort(),
    ["annual", "custom", "daily", "monthly", "none", "quarterly", "weekly"],
  );
  // The rules module defines no frequency→days mapping and never
  // computes dates itself: nothing in the system turns a chosen
  // frequency into an imposed due schedule.
  const source = read("lib/inspections-rules.ts");
  assert.ok(!/frequencyDays|daysPerFrequency/.test(source),
    "rules must not encode frequency schedules");
  assert.ok(!/new Date/.test(source),
    "rules compare stored date strings; they never invent dates");
});

/* ------------------------------------------------------------------ */
/* 2. Static contracts                                                 */
/* ------------------------------------------------------------------ */

const migration = read("supabase/migrations/20261103233000_inspections_pm.sql");
const route = read("app/api/inspections/route.ts");
const download = read("app/api/inspections/download/route.ts");
const printPage = read("app/print/[format]/page.tsx");
const dashboard = read("app/dashboard.tsx");

test("migration: eight server-only tables, private bucket, folio sequence", () => {
  for (const table of [
    "insp_folio_counters", "inspection_templates", "inspection_template_items",
    "inspections", "inspection_results", "corrective_actions",
    "inspection_history", "inspection_attachments",
  ]) {
    assert.ok(migration.includes(`create table if not exists public.${table}`), table);
    assert.ok(migration.includes(`public.${table} enable row level security`), table);
    assert.ok(migration.includes(`${table}_server_only`), table);
  }
  // Dedicated private bucket for this module's evidence.
  assert.ok(migration.includes("'inspections', 'inspections', false"), "bucket must be private");
  // Folio sequence function exists and is not callable by clients.
  assert.ok(migration.includes("next_inspection_folio_number"));
  assert.ok(migration.includes("revoke all on function public.next_inspection_folio_number(integer)"));
  // Result states are exactly Jose's inspection criteria.
  for (const status of ["no_issue", "pending", "in_progress", "waiting_vendor", "completed", "na"]) {
    assert.ok(migration.includes(`'${status}'`), status);
  }
  // A shop closing template type exists; frequency defaults to unset.
  assert.ok(migration.includes("'shop_closing'"));
  assert.ok(migration.includes("frequency_type text not null default 'none'"));
  // Template administration is audited in the shared admin log.
  for (const action of [
    "create_inspection_template", "update_inspection_template",
    "publish_inspection_template", "archive_inspection_template",
  ]) {
    assert.ok(migration.includes(action), action);
  }
});

test("migration: NO seeded templates and nothing destructive", () => {
  // The system ships EMPTY: real The Darley checklists are defined by
  // the administrator; no SOP content is invented by the migration.
  assert.ok(!/insert\s+into\s+public\.inspection_templates/i.test(migration));
  assert.ok(!/insert\s+into\s+public\.inspection_template_items/i.test(migration));
  assert.ok(!migration.includes("drop table"), "additive only");
  assert.ok(!migration.includes("drop column"), "additive only");
});

test("route: member re-checked per request; templates admin-gated and audited", () => {
  assert.ok(route.includes("getCurrentMember"));
  assert.ok(route.includes("canManageTemplates"));
  assert.ok(route.includes("writeTemplateAudit"));
  assert.ok(route.includes("next_inspection_folio_number"));
  // One shop closing record per day is enforced server-side.
  assert.ok(route.includes('eq("template_type", "shop_closing")'));
  assert.ok(route.includes("existingInspectionId"));
  // Inspection snapshots: results are created from the template copy.
  assert.ok(route.includes("inspection_results"));
  // No hard deletes of evidence, history or corrective actions.
  assert.ok(!/from\("(inspections|inspection_results|inspection_history|corrective_actions)"\)\s*\.delete/.test(route));
  assert.ok(!route.includes("createSignedUrl"), "downloads live in the download route only");
});

test("download route: signed URL is short-lived and approval-gated", () => {
  assert.ok(download.includes("canDownloadInspectionAttachment"));
  assert.ok(download.includes("SIGNED_URL_SECONDS = 120"));
  assert.ok(download.includes('const BUCKET = "inspections"'));
});

test("print format: shop closing prints the real record for the date", () => {
  assert.ok(printPage.includes('eq("template_type", "shop_closing")'));
  assert.ok(printPage.includes("inspection_results"));
  assert.ok(printPage.includes("signature_name"));
});

test("dashboard: inspections tab and Hoy card are wired", () => {
  assert.ok(dashboard.includes("InspectionsPanel"));
  assert.ok(dashboard.includes("InspectionsTodayCard"));
  assert.ok(dashboard.includes('"inspections"'));
});
