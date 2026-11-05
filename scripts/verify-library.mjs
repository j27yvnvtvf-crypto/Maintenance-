/**
 * Executable verification for the document library & print formats (Phase 1).
 *
 * Run:  node --test scripts/verify-library.mjs
 *   or: pnpm verify:library
 *
 * Two layers are exercised FOR REAL here:
 *  1. Decision tests — the production permission rules are imported from
 *     lib/library-rules.ts (the exact module the API routes use) and checked
 *     against the Phase 1 acceptance criteria at the decision level. The
 *     suite also asserts lib/library-rules.ts and lib/access-rules.ts agree
 *     on operational/admin access for every account state, so the two
 *     modules cannot silently drift apart.
 *  2. Static contract tests — the shipped source is scanned for the
 *     structural guarantees the module depends on (private bucket created
 *     by the migration, deny-by-default RLS, per-request approval gate,
 *     admin-only management, signed-URL downloads, append-only versions,
 *     audited document actions, no seeded document content, print system
 *     present for all six formats).
 *
 * What this suite does NOT prove: live HTTP behavior against a real
 * Supabase (a pending account receiving 403s end to end, a real file going
 * up to the private bucket and back down through a signed URL, a read
 * confirmation round-trip). Those need a disposable staging Supabase
 * project with the Phase 0 + Phase 1 migrations applied and remain
 * PENDING until one exists — the same staging the Phase 0 E2E harness
 * (scripts/e2e-access-model.mjs) is waiting for. Do not report the
 * end-to-end checks as passed until they run green against staging.
 * See docs/library-and-printables.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isAdminAccess, isApprovedAccess } from "../lib/access-rules.ts";
import {
  canConfirmRead,
  canDownloadVersion,
  canManageDocuments,
  canViewDocument,
  canViewReadEvidence,
  isLibraryAdmin,
  isOperationalAccess,
} from "../lib/library-rules.ts";

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
const admin = (overrides = {}) => approved({ is_admin: true, ...overrides });

const published = { status: "published" };
const draft = { status: "draft" };
const archived = { status: "archived" };
const ALL_DOCS = [published, draft, archived];
const NON_APPROVED = ["unregistered", "pending", "rejected", "suspended", "revoked"];

// ---------------------------------------------------------------------------
// The library primitives mirror the Phase 0 access rules on every state.
// ---------------------------------------------------------------------------
test("library primitives agree with access model v2 on every account state", () => {
  const states = [
    ...NON_APPROVED.map((approval_status) => ({ approval_status, active: false, is_admin: false })),
    { approval_status: "approved", active: false, is_admin: false },
    { approval_status: "approved", active: true, is_admin: false },
    { approval_status: "approved", active: true, is_admin: true },
    { approval_status: "pending", active: false, is_admin: true },
    { approval_status: "suspended", active: false, is_admin: true },
  ];
  for (const state of states) {
    assert.equal(isOperationalAccess(state), isApprovedAccess(state), JSON.stringify(state));
    assert.equal(isLibraryAdmin(state), isAdminAccess(state), JSON.stringify(state));
  }
});

// ---------------------------------------------------------------------------
// Phase 1 criterion 1 — a pending account can neither list nor download.
// Decision level: every non-approved state fails every library decision.
// (HTTP 403 behavior: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("1. Non-approved accounts get nothing from the library", () => {
  for (const status of NON_APPROVED) {
    const person = member({ approval_status: status });
    for (const doc of ALL_DOCS) {
      assert.equal(canViewDocument(person, doc), false, `${status}/${doc.status}`);
      assert.equal(canDownloadVersion(person, doc), false, `${status}/${doc.status}`);
      assert.equal(canConfirmRead(person, doc), false, `${status}/${doc.status}`);
    }
    assert.equal(canManageDocuments(person), false, status);
    assert.equal(canViewReadEvidence(person), false, status);
  }
  // Approved on paper but deactivated (suspension flips both) is also out,
  // even with the admin flag set.
  const suspendedAdmin = member({ approval_status: "approved", active: false, is_admin: true });
  assert.equal(canViewDocument(suspendedAdmin, published), false);
  assert.equal(canManageDocuments(suspendedAdmin), false);
});

// ---------------------------------------------------------------------------
// Phase 1 criterion 2 — an approved account reads PUBLISHED documents and
// confirms reading them; drafts and archived documents do not exist for it.
// ---------------------------------------------------------------------------
test("2. Approved accounts see, download and confirm published documents only", () => {
  const tech = approved({ job_title: "Maintenance Technician" });
  assert.equal(canViewDocument(tech, published), true);
  assert.equal(canDownloadVersion(tech, published), true);
  assert.equal(canConfirmRead(tech, published), true);
  for (const doc of [draft, archived]) {
    assert.equal(canViewDocument(tech, doc), false, doc.status);
    assert.equal(canDownloadVersion(tech, doc), false, doc.status);
    assert.equal(canConfirmRead(tech, doc), false, doc.status);
  }
  // Reading evidence about OTHER people is administrative data.
  assert.equal(canViewReadEvidence(tech), false);
});

// ---------------------------------------------------------------------------
// Phase 1 criterion 3 — a non-admin cannot create, publish, archive or add
// versions, whatever its job title says. The title is not an input to any
// decision function.
// ---------------------------------------------------------------------------
test("3. Non-admins cannot manage documents; a title of 'Admin' changes nothing", () => {
  for (const job_title of ["Admin", "Manager", "Supervisor", "Property Manager"]) {
    const person = approved({ job_title });
    assert.equal(canManageDocuments(person), false, job_title);
    assert.equal(canViewDocument(person, draft), false, job_title);
    assert.equal(canViewDocument(person, archived), false, job_title);
  }
});

// ---------------------------------------------------------------------------
// Phase 1 criterion 4 — only the administrator manages the library and sees
// drafts, archived documents and read evidence.
// ---------------------------------------------------------------------------
test("4. Only the verified administrator manages documents and sees everything", () => {
  const boss = admin();
  assert.equal(canManageDocuments(boss), true);
  assert.equal(canViewReadEvidence(boss), true);
  for (const doc of ALL_DOCS) {
    assert.equal(canViewDocument(boss, doc), true, doc.status);
    assert.equal(canDownloadVersion(boss, doc), true, doc.status);
  }
  // A flagged account that is not approved+active is NOT an administrator.
  assert.equal(canManageDocuments(member({ is_admin: true })), false);
});

// ---------------------------------------------------------------------------
// Static contract tests over the shipped source.
// ---------------------------------------------------------------------------
test("contract: migration creates the library schema and the PRIVATE bucket", () => {
  const migration = read("supabase/migrations/20261103220000_library_documents.sql");
  for (const table of ["documents", "document_versions", "document_reads"]) {
    assert.ok(migration.includes(`create table if not exists public.${table}`), table);
    assert.ok(migration.includes(`revoke all on public.${table} from anon, authenticated`), table);
    assert.ok(migration.includes(`${table}_server_only`), table);
  }
  // Versions and reads are unique per parent: one current file per version
  // number, one confirmation per (version, member).
  assert.ok(migration.includes("unique (document_id, version_number)"));
  assert.ok(migration.includes("unique (version_id, member_id)"));
  // The bucket is created NOT public.
  assert.ok(migration.includes("insert into storage.buckets"));
  assert.ok(migration.includes("values ('documents', 'documents', false)"));
  assert.ok(migration.includes("documents_bucket_server_only"));
  // Document administration is part of the Phase 0 audit trail.
  for (const action of ["create_document", "update_document", "publish_document", "archive_document", "add_document_version"]) {
    assert.ok(migration.includes(`'${action}'`), action);
  }
  // Additive only, and it seeds NO document content: the library starts
  // empty; nobody invents an SOP.
  assert.ok(!/drop table/i.test(migration));
  assert.ok(!/insert into public\.documents/i.test(migration));
  assert.ok(!/insert into public\.document_versions/i.test(migration));
});

test("contract: library API gates per request and audits administration", () => {
  const route = read("app/api/library/route.ts");
  assert.ok(route.includes("getCurrentMember()"));
  assert.ok(route.includes('throw new Error("APPROVAL_REQUIRED")'));
  assert.ok(route.includes("canViewDocument"));
  assert.ok(route.includes("canConfirmRead"));
  assert.ok(route.includes("canManageDocuments"));
  assert.ok(route.includes("writeDocAudit"));
  assert.ok(route.includes("admin_audit_log"));
  for (const action of ["create_document", "add_document_version", "publish_document", "archive_document", "update_document", "confirm_read"]) {
    assert.ok(route.includes(`"${action}"`), action);
  }
  // The list endpoint hides drafts/archived from non-admins entirely.
  assert.ok(route.includes("canViewDocument(me, doc)"));
  // Read confirmations keep the FIRST confirmation time.
  assert.ok(route.includes("ignoreDuplicates: true"));
});

test("contract: versions are append-only — never updated or deleted via the API", () => {
  const route = read("app/api/library/route.ts");
  assert.ok(!route.includes('.from("document_versions").update'));
  assert.ok(!route.includes('.from("document_versions").delete'));
  assert.ok(!route.includes('.from("document_reads").delete'));
  assert.ok(!route.includes('.from("document_reads").update'));
  // New versions go in as new rows with the next version number.
  assert.ok(route.includes("version_number: nextNumber"));
});

test("contract: downloads only happen through the signed-URL route after checks", () => {
  const download = read("app/api/library/download/route.ts");
  assert.ok(download.includes("getCurrentMember()"));
  assert.ok(download.includes('throw new Error("APPROVAL_REQUIRED")'));
  assert.ok(download.includes("canDownloadVersion"));
  assert.ok(download.includes("createSignedUrl"));
  // Short-lived: two minutes.
  assert.ok(download.includes("SIGNED_URL_SECONDS = 120"));
  // The list/detail API never mints download URLs itself.
  const route = read("app/api/library/route.ts");
  assert.ok(!route.includes("createSignedUrl"));
  assert.ok(!route.includes("getPublicUrl"));
});

test("contract: print system covers all six formats with the data split documented in code", () => {
  const page = read("app/print/[format]/page.tsx");
  for (const format of ["daily-assignments", "weekly-plan", "pending-parts-vendors", "inventory-reorder", "shop-closing", "training-log"]) {
    assert.ok(page.includes(`"${format}"`), format);
  }
  // Data-connected formats read real work orders; access is gated.
  assert.ok(page.includes('from("work_orders")'));
  assert.ok(page.includes("isApproved(member)"));
  assert.ok(page.includes('redirect("/login")'));
  // Structured templates render blank rows (paper capture, no duplicate
  // data entry in the app).
  assert.ok(page.includes("BlankRows"));
  // Letter print CSS with page numbers lives in globals.css.
  const css = read("app/globals.css");
  assert.ok(css.includes("@page"));
  assert.ok(css.includes("size: Letter"));
  assert.ok(css.includes("counter(page)"));
  assert.ok(css.includes(".print-sheet"));
});

test("contract: the dashboard exposes the library to approved users", () => {
  const dash = read("app/dashboard.tsx");
  assert.ok(dash.includes("LibraryPanel"));
  assert.ok(dash.includes('"library"'));
});
