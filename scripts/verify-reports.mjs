/**
 * Executable verification for reports & audit dossiers (Phase 4).
 *
 * Run:  node --test scripts/verify-reports.mjs
 *   or: pnpm verify:reports
 *
 * Two layers are exercised FOR REAL here:
 *  1. Decision tests — the production rules are imported from
 *     lib/reports-rules.ts (the exact module the API routes use) and
 *     checked against the Phase 4 acceptance criteria: the permission
 *     matrix (pending = 403 on search AND exports, admin activity is
 *     administrator-only), filter normalization, the case-dossier
 *     assembly over a fixture chain, the declared CSV columns, and the
 *     EVIDENCE HONESTY contract: a record with an attachment but no
 *     recorded verification is "evidence_unverified" — never "verified".
 *     The suite also asserts lib/reports-rules.ts and
 *     lib/access-rules.ts agree on operational and admin access for
 *     every account state, so the modules cannot silently drift apart.
 *  2. Static contract tests — the shipped source is scanned for the
 *     structural guarantees the module depends on (per-request approval
 *     gate in both report routes, CSV generated on the server behind the
 *     export gate, read-only data assembly, printable report/dossier
 *     formats registered, dashboard tab wired, and NO new migration —
 *     Phase 4 reads the tables the earlier phases built).
 *
 * What this suite does NOT prove: live HTTP behavior against a real
 * Supabase (a pending account receiving 403s end to end, a real case
 * chain round-trip through the dossier endpoint, a CSV download of real
 * rows). Those need the disposable staging Supabase project with all
 * migrations applied and remain PENDING until the staging deployment is
 * unblocked (Vercel reauthentication / API token) — the same staging the
 * Phase 0 harness (scripts/e2e-access-model.mjs) is waiting for. Do not
 * report the end-to-end checks as passed until they run green against
 * staging. See docs/reports-audit.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isAdminAccess, isApprovedAccess } from "../lib/access-rules.ts";
import {
  CSV_COLUMNS,
  REPORT_MODULES,
  buildCsv,
  canAccessReports,
  canBuildDossier,
  canExportReports,
  canViewAdminActivity,
  csvEscape,
  dateInRange,
  evidenceState,
  isReportsAdmin,
  isReportsOperational,
  matchesQuery,
  normalizeReportFilters,
  sortTimeline,
  summarizeEvidence,
  unverifiedEntries,
} from "../lib/reports-rules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const member = (overrides = {}) => ({
  approval_status: "pending",
  active: false,
  is_admin: false,
  ...overrides,
});
const approved = (overrides = {}) =>
  member({ approval_status: "approved", active: true, ...overrides });

const NON_APPROVED = ["unregistered", "pending", "rejected", "suspended", "revoked"];
const ALL_DECISIONS = [
  ["canAccessReports", (m) => canAccessReports(m)],
  ["canBuildDossier", (m) => canBuildDossier(m)],
  ["canExportReports", (m) => canExportReports(m)],
];

// ---------------------------------------------------------------------------
// The reports primitives mirror access model v2 on every account state.
// ---------------------------------------------------------------------------
test("reports primitives agree with access model v2 on every account state", () => {
  const states = [
    ...NON_APPROVED.map((approval_status) => ({ approval_status, active: false, is_admin: false })),
    { approval_status: "approved", active: false, is_admin: false },
    { approval_status: "approved", active: true, is_admin: false },
    { approval_status: "approved", active: true, is_admin: true },
    { approval_status: "pending", active: false, is_admin: true },
    { approval_status: "suspended", active: false, is_admin: true },
  ];
  for (const state of states) {
    assert.equal(isReportsOperational(state), isApprovedAccess(state), JSON.stringify(state));
    assert.equal(isReportsAdmin(state), isAdminAccess(state), JSON.stringify(state));
  }
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 1 — a pending (or rejected / suspended / revoked)
// account can neither consult nor EXPORT anything. Decision level: every
// non-approved state fails every decision, including CSV export.
// (HTTP 403 behavior: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("1. Non-approved accounts get nothing — no search, no dossier, no CSV export", () => {
  for (const status of NON_APPROVED) {
    const person = member({ approval_status: status });
    for (const [name, decide] of ALL_DECISIONS) {
      assert.equal(decide(person), false, `${status}/${name}`);
    }
    assert.equal(canViewAdminActivity(person), false, status);
  }
  // Approved on paper but deactivated (suspension) is also out — even
  // with the admin flag set.
  const suspendedAdmin = member({ approval_status: "approved", active: false, is_admin: true });
  for (const [, decide] of ALL_DECISIONS) assert.equal(decide(suspendedAdmin), false);
  assert.equal(canViewAdminActivity(suspendedAdmin), false);
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 2 — every approved account reports in equality,
// whatever its job title says; the administrative history stays
// administrator-only and a job title of "Admin" grants nothing.
// ---------------------------------------------------------------------------
test("2. Approved accounts share identical reporting permissions; admin activity is admin-only", () => {
  for (const job_title of ["Maintenance Technician", "Admin", "Manager", "Service Supervisor"]) {
    const person = approved({ job_title, is_admin: false });
    for (const [name, decide] of ALL_DECISIONS) {
      assert.equal(decide(person), true, `${job_title}/${name}`);
    }
    // Writing "Admin" as the job title does NOT open the admin history.
    assert.equal(canViewAdminActivity(person), false, job_title);
  }
  const boss = approved({ is_admin: true });
  for (const [, decide] of ALL_DECISIONS) assert.equal(decide(boss), true);
  assert.equal(canViewAdminActivity(boss), true);
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 3 — filter normalization: invalid input is dropped,
// reversed ranges are swapped, unknown modules fall back to "all".
// ---------------------------------------------------------------------------
test("3. Filters normalize safely and deterministically", () => {
  const clean = normalizeReportFilters({
    module: "logbook", from: "2026-10-01", to: "2026-10-31",
    memberId: "7", status: "closed", building: " B1 ", unit: "2211",
    q: "  leak  ", lowStock: "1",
  });
  assert.deepEqual(clean, {
    module: "logbook", from: "2026-10-01", to: "2026-10-31", memberId: 7,
    status: "closed", building: "B1", unit: "2211", q: "leak", lowStockOnly: true,
  });
  // Reversed range swaps instead of silently matching nothing.
  const swapped = normalizeReportFilters({ from: "2026-11-10", to: "2026-11-01" });
  assert.equal(swapped.from, "2026-11-01");
  assert.equal(swapped.to, "2026-11-10");
  // Garbage is dropped, never trusted.
  const dirty = normalizeReportFilters({
    module: "secrets", from: "2026-02-30", to: "not-a-date",
    memberId: "-3", status: "Closed; DROP", q: "x".repeat(500),
  });
  assert.equal(dirty.module, "all");
  assert.equal(dirty.from, null);
  assert.equal(dirty.to, null);
  assert.equal(dirty.memberId, null);
  assert.equal(dirty.status, null);
  assert.equal(dirty.q.length, 120);
  // The range and text rules the fetchers apply behave on fixtures.
  const filters = normalizeReportFilters({ from: "2026-10-01", to: "2026-10-31", q: "leak" });
  const fixture = [
    { day: "2026-09-30", fields: ["leak in 2211"] },
    { day: "2026-10-05", fields: ["BIT-2026-0001", "Leak under sink"] },
    { day: "2026-10-20", fields: ["AC repair"] },
    { day: "2026-11-02", fields: ["leak check"] },
  ];
  const hits = fixture.filter((row) => dateInRange(row.day, filters) && matchesQuery(filters.q, row.fields));
  assert.deepEqual(hits.map((row) => row.day), ["2026-10-05"]);
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 4 — the dossier assembles the COMPLETE case chain:
// leak → inspection → vendor visit → repair → corrective action →
// verification, in chronological order, from scrambled input.
// ---------------------------------------------------------------------------
test("4. A case dossier gathers the full chain, chronologically", () => {
  const entry = (kind, id, ref, date, evidence, extra = {}) => ({
    kind, id, ref, date, title: ref, status: null, detail: null,
    evidence, attachmentCount: 0, verifiedByName: null, verifiedAt: null, ...extra,
  });
  const scrambled = [
    entry("log_event", 2, "BIT-2026-0002", "2026-10-05T15:00:00Z", "verified",
      { attachmentCount: 1, verifiedByName: "Brian", verifiedAt: "2026-10-05T15:00:00Z" }),
    entry("work_order", 9, "#9", "2026-10-03T09:00:00Z", null),
    entry("vendor_job", 7, "#7", "2026-10-02T10:00:00Z", "evidence_unverified", { attachmentCount: 3 }),
    entry("log_event", 1, "BIT-2026-0001", "2026-10-01T08:00:00Z", "evidence_unverified", { attachmentCount: 2 }),
    entry("corrective_action", 3, "#3", "2026-10-04T12:00:00Z", "verified",
      { attachmentCount: 1, verifiedByName: "Jose Suarez", verifiedAt: "2026-10-04T12:30:00Z" }),
    entry("inspection", 5, "INS-2026-0003", "2026-10-01T11:00:00Z", "evidence_unverified", { attachmentCount: 4 }),
  ];
  const timeline = sortTimeline(scrambled);
  assert.deepEqual(
    timeline.map((row) => `${row.kind}:${row.ref}`),
    [
      "log_event:BIT-2026-0001",   // the leak
      "inspection:INS-2026-0003",  // the inspection
      "vendor_job:#7",             // the roofer visit / report
      "work_order:#9",             // the interior repair
      "corrective_action:#3",      // the verified corrective action
      "log_event:BIT-2026-0002",   // the final verification event
    ],
  );
  const summary = summarizeEvidence(timeline);
  assert.deepEqual(summary, {
    total: 6, withEvidenceSemantics: 5, verified: 2, evidenceUnverified: 3, noEvidence: 0,
  });
  // The "not verified" section holds exactly the evidence-only records.
  assert.deepEqual(
    unverifiedEntries(timeline).map((row) => row.ref),
    ["BIT-2026-0001", "INS-2026-0003", "#7"],
  );
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 5 — THE HONESTY CONTRACT. An attachment is evidence,
// never verification. Verification requires BOTH a verifier and a date;
// a completed status alone is not a verification either.
// ---------------------------------------------------------------------------
test("5. Honesty contract: attachments never make a record 'verified'", () => {
  // Evidence present, no verification act → evidence_unverified.
  assert.equal(
    evidenceState({ attachmentCount: 5, verifiedByName: null, verifiedAt: null }),
    "evidence_unverified",
  );
  // A verifier name without the act's timestamp is not a verification.
  assert.equal(
    evidenceState({ attachmentCount: 5, verifiedByName: "Jose Suarez", verifiedAt: null }),
    "evidence_unverified",
  );
  // A timestamp without a verifier is not a verification.
  assert.equal(
    evidenceState({ attachmentCount: 0, verifiedByName: null, verifiedAt: "2026-10-04T12:30:00Z" }),
    "no_evidence",
  );
  // Both author and timestamp → verified (attachments irrelevant).
  assert.equal(
    evidenceState({ attachmentCount: 0, verifiedByName: "Jose Suarez", verifiedAt: "2026-10-04T12:30:00Z" }),
    "verified",
  );
  // Neither evidence nor verification.
  assert.equal(
    evidenceState({ attachmentCount: 0, verifiedByName: null, verifiedAt: null }),
    "no_evidence",
  );
});

// ---------------------------------------------------------------------------
// Phase 4 criterion 6 — the CSV contains exactly the declared columns,
// escapes content safely and neutralizes spreadsheet formulas.
// ---------------------------------------------------------------------------
test("6. CSV export carries the declared columns and safe escaping", () => {
  for (const mod of REPORT_MODULES) {
    assert.ok(Array.isArray(CSV_COLUMNS[mod]) && CSV_COLUMNS[mod].length >= 5, mod);
    const keys = CSV_COLUMNS[mod].map((column) => column.key);
    assert.equal(new Set(keys).size, keys.length, `${mod} duplicate keys`);
  }
  // Evidence-bearing modules must export the honesty fields.
  for (const mod of ["logbook", "inspections", "corrective", "vendors"]) {
    const keys = CSV_COLUMNS[mod].map((column) => column.key);
    assert.ok(keys.includes("attachments"), `${mod}/attachments`);
    assert.ok(keys.includes("evidenceState"), `${mod}/evidenceState`);
  }
  for (const mod of ["logbook", "corrective", "vendors"]) {
    const keys = CSV_COLUMNS[mod].map((column) => column.key);
    assert.ok(keys.includes("verifiedBy"), `${mod}/verifiedBy`);
    assert.ok(keys.includes("verifiedAt"), `${mod}/verifiedAt`);
  }
  const csv = buildCsv("logbook", [{
    id: 1, folio: "BIT-2026-0001", occurredAt: "2026-10-01T08:00:00Z",
    registeredAt: "2026-10-01T08:05:00Z", type: "leak", status: "closed",
    priority: "high", building: "B1", unit: "2211", area: "Kitchen",
    equipment: null, description: 'Leak, "active" drip', reportedBy: "Brian",
    responsible: "Jose Suarez", followUpDate: null, finalResult: "Repaired",
    attachments: 2, evidenceState: "evidence_unverified",
    verifiedBy: null, verifiedAt: null, officialWoRef: null,
  }]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    CSV_COLUMNS.logbook.map((column) => column.header).join(","),
  );
  assert.ok(lines[1].includes('"Leak, ""active"" drip"'), "comma/quote escaping");
  assert.ok(lines[1].includes("evidence_unverified"), "honest state exported as-is");
  assert.ok(!lines[1].includes(",verified,"), "never upgraded to verified");
  // Formula injection is neutralized.
  assert.equal(csvEscape("=2+5"), "'=2+5");
  assert.equal(csvEscape("+SUM(A1:A2)"), "'+SUM(A1:A2)");
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(42), "42");
});

// ---------------------------------------------------------------------------
// Static contract tests over the shipped source.
// ---------------------------------------------------------------------------
test("contract: both report routes gate per request; exports are server-generated", () => {
  const route = read("app/api/reports/route.ts");
  assert.ok(route.includes("getCurrentMember()"));
  assert.ok(route.includes("canAccessReports(me)"));
  assert.ok(route.includes('throw new Error("APPROVAL_REQUIRED")'));
  // The dossier endpoints sit behind the same operational gate.
  assert.ok(route.includes("buildCaseDossier"));
  assert.ok(route.includes("buildUnitDossier"));
  // Administrative history: admin-only, read from the SAME Phase 0 table.
  assert.ok(route.includes('params.get("adminActivity")'));
  assert.ok(route.includes("canViewAdminActivity(me)"));
  assert.ok(route.includes('from("admin_audit_log")'));
  assert.ok(route.includes('throw new Error("FORBIDDEN")'));

  const exp = read("app/api/reports/export/route.ts");
  assert.ok(exp.includes("getCurrentMember()"));
  assert.ok(exp.includes("canExportReports(me)"));
  assert.ok(exp.includes('throw new Error("APPROVAL_REQUIRED")'));
  // The permission check runs BEFORE any row is fetched for the file
  // (the call site, not the import).
  assert.ok(exp.indexOf("canExportReports(me)") < exp.indexOf("fetchCsvRows(admin"));
  // Server-generated file: declared columns + attachment download headers.
  assert.ok(exp.includes("buildCsv"));
  assert.ok(exp.includes("Content-Disposition"));
  assert.ok(exp.includes('attachment; filename="the-darley-'));
});

test("contract: Phase 4 data assembly is READ-ONLY and queries the existing tables", () => {
  const server = read("lib/reports-server.ts");
  for (const table of [
    "log_events", "log_event_links", "inspections", "corrective_actions",
    "work_orders", "inventory_items", "inventory_movements",
    "reorder_requests", "tools", "assets", "refrigerant_logs",
    "vendor_jobs",
  ]) {
    assert.ok(server.includes(`from("${table}")`), table);
  }
  // Attachment counts go through the one counting helper, per bucket table.
  for (const table of ["log_attachments", "inspection_attachments", "vendor_attachments"]) {
    assert.ok(server.includes(`countAttachments(admin, "${table}"`), table);
  }
  // No write path of any kind in the assembly or in either route.
  for (const source of [server, read("app/api/reports/route.ts"), read("app/api/reports/export/route.ts")]) {
    assert.ok(!source.includes(".insert("), "insert");
    assert.ok(!source.includes(".update("), "update");
    assert.ok(!source.includes(".delete("), "delete");
    assert.ok(!source.includes(".upsert("), "upsert");
  }
  // Evidence states in the assembly come from the ONE pure honesty rule.
  assert.ok(server.includes("evidenceState({"));
  // Chain traversal reads the links in both directions, like the logbook.
  assert.ok(server.includes('from("log_event_links")'));
});

test("contract: printable report + dossier formats and the dashboard tab exist", () => {
  const print = read("app/print/[format]/page.tsx");
  assert.ok(print.includes('"audit-report"'));
  assert.ok(print.includes('"case-dossier"'));
  assert.ok(print.includes("searchReports"));
  assert.ok(print.includes("buildCaseDossier"));
  assert.ok(print.includes("buildUnitDossier"));
  // Who generated the sheet is printed on it.
  assert.ok(print.includes("generatedBy"));
  const dash = read("app/dashboard.tsx");
  assert.ok(dash.includes("ReportsPanel"));
  assert.ok(dash.includes('"reports"'));
  const panel = read("app/reports-panel.tsx");
  assert.ok(panel.includes("/api/reports?"));
  assert.ok(panel.includes("/api/reports/export?"));
  assert.ok(panel.includes("/print/audit-report?"));
  assert.ok(panel.includes("/print/case-dossier?"));
});

test("contract: Phase 4 adds NO migration — it reads the phases 0–3 schema", () => {
  const migrations = readdirSync(join(root, "supabase/migrations")).sort();
  assert.deepEqual(migrations, [
    "202609210001_initial_schema.sql",
    "20260921201927_harden_direct_access_and_indexes.sql",
    "20261103213000_access_model_v2.sql",
    "20261103220000_library_documents.sql",
    "20261103221500_member_phone.sql",
    "20261103230000_logbook.sql",
    "20261103233000_inspections_pm.sql",
    "20261103240000_inventory_vendors.sql",
  ]);
});
