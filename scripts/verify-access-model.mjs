/**
 * Executable verification for access model v2 (Phase 0).
 *
 * Run:  node --test scripts/verify-access-model.mjs
 *   or: pnpm verify:access
 *
 * Two layers are exercised FOR REAL here:
 *  1. Decision tests — the production authorization rules are imported from
 *     lib/access-rules.ts (the exact module the API routes use) and checked
 *     against the six mandatory acceptance criteria at the decision level.
 *  2. Static contract tests — the shipped source is scanned for the
 *     structural guarantees the model depends on (no email allow-list in the
 *     runtime, no role gates left, no delete path for work orders or
 *     history, is_admin never assigned by app code, per-request state
 *     checks, deny-by-default RLS for the audit log, additive migration).
 *
 * What this suite does NOT prove: live HTTP behavior against a real
 * Supabase (pending accounts receiving 403s end to end, a suspended session
 * dying mid-flight, two real users creating and closing work orders). Those
 * are covered by scripts/e2e-access-model.mjs, which needs a disposable
 * staging Supabase project and is PENDING until one exists. See
 * docs/access-model-verification.md for the full matrix. Do not report the
 * end-to-end checks as passed until that script runs green against staging.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  accessState,
  canAdminActOn,
  canRequestAccess,
  isAdminAccess,
  isApprovedAccess,
} from "../lib/access-rules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const member = (overrides = {}) => ({
  id: 1,
  approval_status: "pending",
  active: false,
  is_admin: false,
  job_title: null,
  ...overrides,
});
const approved = (overrides = {}) =>
  member({ approval_status: "approved", active: true, ...overrides });

// ---------------------------------------------------------------------------
// Mandatory check 1 — a pending account cannot consult data or files.
// Decision level: every data endpoint gates on isApprovedAccess, so a
// pending / rejected / suspended / revoked account is stopped before any
// query runs. (HTTP 403 behavior: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("1. Non-approved states have no operational access", () => {
  for (const status of ["unregistered", "pending", "rejected", "suspended", "revoked"]) {
    assert.equal(isApprovedAccess(member({ approval_status: status })), false, status);
  }
  // 'approved' on paper but deactivated (suspension flips both) is also out.
  assert.equal(isApprovedAccess(member({ approval_status: "approved", active: false })), false);
  assert.equal(isApprovedAccess(approved()), true);
  assert.equal(accessState(member()), "pending");
  assert.equal(accessState(approved()), "approved");
});

// ---------------------------------------------------------------------------
// Mandatory check 2 — writing "Admin" (or any title) grants no privileges.
// The job title is not even an input to the decision functions: an approved
// account titled "Admin" has operational access and ZERO admin access.
// ---------------------------------------------------------------------------
test("2. A job title of 'Admin'/'Manager'/'Supervisor' grants nothing", () => {
  for (const job_title of ["Admin", "Manager", "Supervisor", "administrator", "ADMIN"]) {
    const person = approved({ job_title });
    assert.equal(isApprovedAccess(person), true, job_title);
    assert.equal(isAdminAccess(person), false, job_title);
  }
});

// ---------------------------------------------------------------------------
// Mandatory check 3 — two approved users with different job titles have the
// same operational permissions. Operational access is a single boolean
// (isApprovedAccess); there is no per-title/per-role tier anywhere.
// (Actual WO create/close over HTTP: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("3. Approved users with different titles are operational equals", () => {
  const a = approved({ id: 10, job_title: "Maintenance Technician" });
  const b = approved({ id: 11, job_title: "Property Manager" });
  assert.equal(isApprovedAccess(a), isApprovedAccess(b));
  assert.equal(isAdminAccess(a), isAdminAccess(b));
});

// ---------------------------------------------------------------------------
// Mandatory check 4 — a regular user cannot administer. Only is_admin
// accounts pass the admin gate, and every admin action additionally
// requires the target to be a different account (no self-administration).
// ---------------------------------------------------------------------------
test("4. Non-admins cannot administer; admins cannot act on themselves", () => {
  const regular = approved({ id: 20 });
  const other = approved({ id: 21 });
  assert.equal(canAdminActOn(regular, other), false);
  const admin = approved({ id: 30, is_admin: true });
  assert.equal(canAdminActOn(admin, other), true);
  assert.equal(canAdminActOn(admin, admin), false);
  assert.equal(canAdminActOn(admin, { id: 30 }), false);
});

// ---------------------------------------------------------------------------
// Mandatory check 5 — a suspended account loses access even with an open
// session. Decision level: a suspended/revoked state fails the same gate
// every route evaluates per request, and the account cannot reactivate
// itself. (Mid-session HTTP behavior: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("5. Suspended/revoked accounts fail the per-request gate and cannot self-reactivate", () => {
  for (const status of ["suspended", "revoked"]) {
    const person = member({ approval_status: status, active: false });
    assert.equal(isApprovedAccess(person), false, status);
    assert.equal(isAdminAccess({ ...person, is_admin: true }), false, status);
    assert.equal(canRequestAccess(person), false, status);
  }
  // A rejected account may ask again; a pending account may update its title.
  assert.equal(canRequestAccess(member({ approval_status: "rejected" })), true);
  assert.equal(canRequestAccess(member({ approval_status: "pending" })), true);
});

// ---------------------------------------------------------------------------
// Mandatory check 6 — administrative control is exclusive to the verified
// admin account: the flag is the only path, and it survives no other state.
// ---------------------------------------------------------------------------
test("6. Only an approved, active, flagged account is administrator", () => {
  assert.equal(isAdminAccess(approved({ is_admin: true })), true);
  assert.equal(isAdminAccess(approved({ is_admin: false })), false);
  assert.equal(isAdminAccess(member({ is_admin: true })), false); // flagged but not approved
  assert.equal(isAdminAccess(approved({ is_admin: true, active: false })), false);
});

// ---------------------------------------------------------------------------
// Static contract tests over the shipped source.
// ---------------------------------------------------------------------------
test("contract: no email allow-list remains in the runtime", () => {
  for (const path of ["lib/access.ts", "app/api/dashboard/route.ts", "app/api/ai/route.ts", "app/login/page.tsx", "app/dashboard.tsx"]) {
    const src = read(path);
    assert.ok(!src.includes("SUPERVISOR_EMAILS"), path);
    assert.ok(!src.includes("configuredSupervisor"), path);
  }
});

test("contract: no legacy role gates remain in the API", () => {
  const dashboard = read("app/api/dashboard/route.ts");
  const ai = read("app/api/ai/route.ts");
  for (const src of [dashboard, ai]) {
    assert.ok(!src.includes("isServiceSupervisor"));
    assert.ok(!src.includes("request_role"));
    assert.ok(!src.includes("change_member_role"));
    assert.ok(!src.includes('.role ==='));
    assert.ok(!src.includes("Manager access is read-only"));
  }
  // Operational equality: create/update job are gated by approval only.
  assert.ok(dashboard.includes('body.action === "create_job"'));
  assert.ok(dashboard.includes('body.action === "update_job"'));
});

test("contract: work orders and history cannot be deleted through the API", () => {
  const dashboard = read("app/api/dashboard/route.ts");
  assert.ok(!dashboard.includes('.from("work_orders").delete'));
  assert.ok(!dashboard.includes('.from("members").delete'));
  assert.ok(!dashboard.includes('.from("admin_audit_log").delete'));
  assert.ok(!dashboard.includes('.from("admin_audit_log").update'));
  // Closing traceability is written on update_job.
  assert.ok(dashboard.includes("closed_by"));
  assert.ok(dashboard.includes("updated_by"));
});

test("contract: application code never assigns is_admin", () => {
  const files = [
    "lib/access.ts",
    "app/api/dashboard/route.ts",
    "app/api/ai/route.ts",
    ...readdirSync(join(root, "supabase/migrations")).map((f) => `supabase/migrations/${f}`),
  ];
  for (const path of files) {
    const src = read(path);
    assert.ok(!/is_admin\s*[:=]\s*true/.test(src), path);
  }
  // New members are explicitly created non-admin.
  assert.ok(read("lib/access.ts").includes("is_admin: false"));
});

test("contract: every API route re-checks member state per request", () => {
  for (const path of ["app/api/dashboard/route.ts", "app/api/ai/route.ts"]) {
    const src = read(path);
    assert.ok(src.includes("getCurrentMember()"), path);
    assert.ok(src.includes("isApproved"), path);
  }
  const dashboard = read("app/api/dashboard/route.ts");
  // Unapproved accounts get an empty bootstrap payload, never data.
  assert.ok(dashboard.includes("team: []"));
  assert.ok(dashboard.includes("jobs: []"));
  // Admin actions exist, are admin-gated, and are audited.
  for (const action of ["approve_member", "reject_member", "suspend_member", "revoke_member", "add_member"]) {
    assert.ok(dashboard.includes(`"${action}"`), action);
  }
  assert.ok(dashboard.includes("writeAudit"));
  assert.ok(dashboard.includes("admin_audit_log"));
});

test("contract: migration is additive and locks the audit log down", () => {
  const migration = read("supabase/migrations/20261103213000_access_model_v2.sql");
  assert.ok(migration.includes("job_title"));
  assert.ok(migration.includes("is_admin boolean not null default false"));
  assert.ok(migration.includes("admin_audit_log"));
  assert.ok(migration.includes("admin_audit_log_server_only"));
  assert.ok(migration.includes("revoke all on public.admin_audit_log from anon, authenticated"));
  assert.ok(!/drop table/i.test(migration));
  assert.ok(!/drop column/i.test(migration));
  // The migration grants admin to nobody.
  assert.ok(!/set\s+is_admin\s*=\s*true/i.test(migration));
});

test("contract: registration has no role selector; job title is free text", () => {
  const login = read("app/login/page.tsx");
  assert.ok(login.includes("job_title"));
  const dash = read("app/dashboard.tsx");
  assert.ok(!dash.includes("request_role"));
  assert.ok(dash.includes("request_access"));
});
