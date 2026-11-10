/**
 * Executable verification for the Centro de Operaciones (Phase 5,
 * Stage A1: data + pure rules).
 *
 * Run:  node --test scripts/verify-centro.mjs
 *   or: pnpm verify:centro
 *
 * Two layers are exercised FOR REAL here:
 *  1. Decision tests — the production rules are imported from
 *     lib/jobs-rules.ts and lib/notes-rules.ts (the exact modules the
 *     API routes will use) and checked against the Phase 5 rules:
 *     a hold demands its four recorded facts, a closing demands its
 *     recorded verification, transitions out of 'completed' only
 *     reopen, the day list orders by urgency + overdue + blocked
 *     follow-ups, the guided notes NEVER claim completion without a
 *     valid verification and ALWAYS end a hold with "Placed on hold
 *     pending ...", and the notes fingerprint tracks the facts.
 *  2. Static contract tests — the Phase 5 migration is scanned for
 *     the structural guarantees the module depends on: additive only
 *     (no table/column drops), the new tables and columns, widened
 *     CHECKs that keep every previously valid value, RLS revoked from
 *     anon/authenticated on every new table, and the PRIVATE "jobs"
 *     bucket.
 *
 * What this suite does NOT prove: live HTTP behavior against a real
 * Supabase (hold without fields → 400, closing without verification →
 * 400, optimistic-lock 409, a completed vendor visit leaving the work
 * order open, pending account → 403). Those live in
 * scripts/e2e-centro.mjs against the disposable staging project and
 * remain PENDING until that run is green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  HOLD_STATUSES,
  JOB_BUILDINGS,
  JOB_CATEGORIES,
  JOB_ORIGINS,
  JOB_PRIORITIES,
  JOB_STATUSES,
  canTransition,
  jobMatchesFilters,
  priorityScore,
  sortJobsForToday,
  validateClose,
  validateHold,
} from "../lib/jobs-rules.ts";
import {
  NOTE_ACTION_OPTIONS,
  NOTE_FINDING_OPTIONS,
  NOTE_TEST_OPTIONS,
  buildMaintenanceComment,
  buildResidentNote,
  hasValidVerification,
  notesFingerprint,
} from "../lib/notes-rules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const holdJob = (overrides = {}) => ({
  status: "waiting_parts",
  holdReason: "Evaporator coil on order",
  holdFollowUpDate: "2026-11-12",
  holdFollowUpBy: 3,
  nextAction: "Call the supplier to confirm the delivery date",
  ...overrides,
});

const closableJob = (overrides = {}) => ({
  actionPerformed: "Replaced the capacitor and cleaned the coil",
  verificationAction: null,
  verificationTest: "Ran the system for 20 minutes",
  verificationResult: "Cooling normally, 68°F supply air",
  verificationConfirmed: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Catalogues: statuses, holds, priorities, categories, buildings, origins.
// ---------------------------------------------------------------------------
test("catalogues match the Phase 5 contract", () => {
  assert.deepEqual(HOLD_STATUSES, ["waiting_vendor", "waiting_parts", "waiting_resident", "on_hold"]);
  for (const status of ["open", "assigned", "in_progress", "on_hold", "waiting_vendor", "waiting_parts", "waiting_resident", "completed"]) {
    assert.ok(JOB_STATUSES.includes(status), status);
  }
  assert.deepEqual(JOB_PRIORITIES, ["low", "medium", "high", "emergency"]);
  assert.deepEqual(JOB_BUILDINGS, [
    "1000", "2000", "3000", "4000", "5000", "6000", "7000",
    "Clubhouse", "Pool", "Grills", "Shop", "Office", "Grounds", "Other",
  ]);
  assert.deepEqual(JOB_ORIGINS, [
    "daily_operation", "resident", "rmm_audit", "client_requirement", "move_out", "preventive",
  ]);
  const categoryEs = JOB_CATEGORIES.map((category) => category.es);
  for (const label of [
    "HVAC", "Plomería", "Electricidad", "Electrodomésticos", "Puertas y cerraduras",
    "Seguridad", "Pintura / drywall", "Limpieza", "Piscina y áreas comunes", "General",
  ]) {
    assert.ok(categoryEs.includes(label), label);
  }
  for (const category of JOB_CATEGORIES) {
    assert.ok(category.key && category.es && category.en, JSON.stringify(category));
  }
});

// ---------------------------------------------------------------------------
// validateHold — every hold status demands the same four recorded facts.
// ---------------------------------------------------------------------------
test("validateHold rejects each missing field and accepts a complete hold", () => {
  for (const status of HOLD_STATUSES) {
    assert.deepEqual(validateHold(holdJob({ status })), [], status);
    assert.equal(validateHold(holdJob({ status, holdReason: null })).length, 1, status);
    assert.equal(validateHold(holdJob({ status, holdReason: "   " })).length, 1, status);
    assert.equal(validateHold(holdJob({ status, holdFollowUpDate: null })).length, 1, status);
    assert.equal(validateHold(holdJob({ status, holdFollowUpBy: null })).length, 1, status);
    assert.equal(validateHold(holdJob({ status, nextAction: null })).length, 1, status);
    assert.equal(validateHold(holdJob({ status, nextAction: "" })).length, 1, status);
  }
  // Everything missing at once → all four errors, in Spanish.
  const errors = validateHold({ status: "waiting_vendor" });
  assert.equal(errors.length, 4);
  for (const error of errors) assert.ok(/[áéíóúñ]/i.test(error) || /Falta/.test(error), error);
  // A job that is not on hold needs none of the four fields.
  assert.deepEqual(validateHold({ status: "open" }), []);
  assert.deepEqual(validateHold({ status: "in_progress" }), []);
  assert.deepEqual(validateHold({ status: "completed" }), []);
});

// ---------------------------------------------------------------------------
// validateClose — no closing without the recorded verification.
// ---------------------------------------------------------------------------
test("validateClose rejects without each requirement and accepts a complete closing", () => {
  assert.deepEqual(validateClose(closableJob()), []);
  // The performed work may come from verification_action instead.
  assert.deepEqual(validateClose(closableJob({ actionPerformed: null, verificationAction: "Final repair confirmed" })), []);
  assert.equal(validateClose(closableJob({ actionPerformed: null, verificationAction: null })).length, 1);
  assert.equal(validateClose(closableJob({ actionPerformed: "  " })).length, 1);
  assert.equal(validateClose(closableJob({ verificationTest: null })).length, 1);
  assert.equal(validateClose(closableJob({ verificationResult: null })).length, 1);
  assert.equal(validateClose(closableJob({ verificationConfirmed: false })).length, 1);
  assert.equal(validateClose(closableJob({ verificationConfirmed: null })).length, 1);
  // Nothing recorded at all → all four errors.
  assert.equal(validateClose({}).length, 4);
});

// ---------------------------------------------------------------------------
// canTransition — the only hard bans, reopening included.
// ---------------------------------------------------------------------------
test("canTransition forbids no-ops, legacy 'assigned' and exits from completed except reopening", () => {
  assert.equal(canTransition("open", "open"), false);
  assert.equal(canTransition("completed", "completed"), false);
  assert.equal(canTransition("open", "in_progress"), true);
  assert.equal(canTransition("open", "waiting_vendor"), true);
  assert.equal(canTransition("waiting_parts", "in_progress"), true);
  assert.equal(canTransition("waiting_resident", "completed"), true);
  assert.equal(canTransition("in_progress", "completed"), true);
  // 'assigned' is legacy read-only: nothing moves into it.
  assert.equal(canTransition("open", "assigned"), false);
  assert.equal(canTransition("assigned", "open"), true);
  // A completed job may only reopen — never into a hold, never re-closed.
  assert.equal(canTransition("completed", "open"), true);
  assert.equal(canTransition("completed", "in_progress"), true);
  assert.equal(canTransition("completed", "waiting_vendor"), false);
  assert.equal(canTransition("completed", "waiting_parts"), false);
  assert.equal(canTransition("completed", "waiting_resident"), false);
  assert.equal(canTransition("completed", "on_hold"), false);
  // Unknown states are not transitions.
  assert.equal(canTransition("open", "bogus"), false);
  assert.equal(canTransition("bogus", "open"), false);
});

// ---------------------------------------------------------------------------
// priorityScore / sortJobsForToday — the suggested order for the day.
// ---------------------------------------------------------------------------
test("priorityScore orders an overdue emergency above normal work", () => {
  const today = "2026-11-09";
  const overdueEmergency = { id: 1, status: "open", priority: "emergency", dueDate: "2026-11-06", scheduledDate: null };
  const normal = { id: 2, status: "open", priority: "medium", dueDate: "2026-11-15", scheduledDate: null };
  const dueTodayLow = { id: 3, status: "open", priority: "low", dueDate: "2026-11-09", scheduledDate: null };
  const blockedDue = { id: 4, status: "waiting_parts", priority: "medium", dueDate: null, scheduledDate: null, holdFollowUpDate: "2026-11-08" };
  const done = { id: 5, status: "completed", priority: "emergency", dueDate: "2026-11-01", scheduledDate: null };

  assert.ok(priorityScore(overdueEmergency, today) > priorityScore(normal, today));
  assert.ok(priorityScore(dueTodayLow, today) > priorityScore(normal, today) - 30);
  // A blocked job whose follow-up is already due outranks the same job unblocked.
  const unblocked = { ...blockedDue, status: "open", holdFollowUpDate: null };
  assert.ok(priorityScore(blockedDue, today) > priorityScore(unblocked, today));
  // Completed work never leads the day.
  assert.ok(priorityScore(done, today) < priorityScore(normal, today));

  const sorted = sortJobsForToday([normal, done, dueTodayLow, overdueEmergency, blockedDue], today);
  assert.equal(sorted[0].id, 1, "overdue emergency first");
  assert.equal(sorted[sorted.length - 1].id, 5, "completed last");
});

// ---------------------------------------------------------------------------
// jobMatchesFilters — combinable filters, AND semantics.
// ---------------------------------------------------------------------------
test("jobMatchesFilters applies every present filter", () => {
  const job = {
    id: 42, title: "AC not cooling", description: "Tenant reports warm air",
    externalRef: "WO-8811", building: "3000", unit: "3105", category: "hvac",
    assignedTo: 7, priority: "high", status: "in_progress", origin: "resident",
    vendorId: 2, scheduledDate: "2026-11-09", dueDate: "2026-11-10", createdAt: "2026-11-08T12:00:00Z",
  };
  assert.equal(jobMatchesFilters(job, {}), true);
  assert.equal(jobMatchesFilters(job, { building: "3000" }), true);
  assert.equal(jobMatchesFilters(job, { building: "2000" }), false);
  assert.equal(jobMatchesFilters(job, { unit: "3105", category: "hvac" }), true);
  assert.equal(jobMatchesFilters(job, { assignedTo: 7, priority: "high", status: "in_progress" }), true);
  assert.equal(jobMatchesFilters(job, { assignedTo: 8 }), false);
  assert.equal(jobMatchesFilters(job, { origin: "resident", vendorId: 2 }), true);
  assert.equal(jobMatchesFilters(job, { origin: "preventive" }), false);
  assert.equal(jobMatchesFilters(job, { status: ["open", "in_progress"] }), true);
  assert.equal(jobMatchesFilters(job, { status: ["open"] }), false);
  assert.equal(jobMatchesFilters(job, { from: "2026-11-09", to: "2026-11-09" }), true);
  assert.equal(jobMatchesFilters(job, { from: "2026-11-10" }), false);
  assert.equal(jobMatchesFilters(job, { q: "cooling" }), true);
  assert.equal(jobMatchesFilters(job, { q: "wo-8811" }), true);
  assert.equal(jobMatchesFilters(job, { q: "3105" }), true);
  assert.equal(jobMatchesFilters(job, { q: "42" }), true);
  assert.equal(jobMatchesFilters(job, { q: "plumbing" }), false);
});

// ---------------------------------------------------------------------------
// Notes guards — completion claims only with a valid verification.
// ---------------------------------------------------------------------------
const verifiedJob = (overrides = {}) => ({
  title: "AC not cooling",
  building: "3000",
  unit: "3105",
  status: "completed",
  findings: "Capacitor failed",
  cause: null,
  actionPerformed: "Replaced the capacitor",
  verificationTest: "Ran the system for 20 minutes",
  verificationResult: "Cooling normally",
  verificationConfirmed: true,
  verifiedAt: "2026-11-09T15:30:00Z",
  ...overrides,
});

test("notes: 'Work order completed' appears only with valid verification", () => {
  const picks = { findings: ["ac_not_cooling"], actions: ["replaced_part"], tests: ["operational_test"] };
  const verified = buildMaintenanceComment(verifiedJob(), picks);
  assert.ok(verified.startsWith("Work order completed."), verified);
  assert.ok(verified.includes("The air conditioning system was not cooling properly."));
  assert.ok(verified.includes("Verification result: Cooling normally."));

  // Confirmation flag alone (no verified_at) is NOT verification.
  const flagOnly = buildMaintenanceComment(verifiedJob({ verifiedAt: null, status: "in_progress" }), picks);
  assert.ok(!/completed/i.test(flagOnly), flagOnly);
  assert.ok(!hasValidVerification({ verificationConfirmed: true, verifiedAt: null }));
  // verified_at alone (no confirmation) is NOT verification either.
  const stampOnly = buildMaintenanceComment(verifiedJob({ verificationConfirmed: false, status: "in_progress" }), picks);
  assert.ok(!/completed/i.test(stampOnly), stampOnly);
  assert.ok(!hasValidVerification({ verificationConfirmed: false, verifiedAt: "2026-11-09T15:30:00Z" }));
  assert.ok(hasValidVerification(verifiedJob()));
});

test("notes: a hold comment ends with 'Placed on hold pending ...' naming what it waits on", () => {
  const vendorHold = buildMaintenanceComment(
    verifiedJob({
      status: "waiting_vendor", verificationConfirmed: false, verifiedAt: null,
      holdReason: "awaiting the vendor's diagnosis", vendorName: "Cool Air Pros",
      nextAction: "Confirm the visit on 2026-11-12",
    }),
    {},
  );
  assert.ok(vendorHold.endsWith("Placed on hold pending the scheduled vendor visit (Cool Air Pros) — awaiting the vendor's diagnosis."), vendorHold);
  assert.ok(!/completed/i.test(vendorHold), vendorHold);

  const partsHold = buildMaintenanceComment(
    { status: "waiting_parts", holdReason: null, vendorName: null, nextAction: null },
    {},
  );
  assert.ok(partsHold.endsWith("Placed on hold pending the arrival of the required parts."), partsHold);

  const residentHold = buildMaintenanceComment(
    { status: "waiting_resident", holdReason: null, vendorName: null, nextAction: null },
    {},
  );
  assert.ok(residentHold.endsWith("Placed on hold pending coordination with the resident to schedule access."), residentHold);
});

test("notes: the resident note claims completion only when verified", () => {
  const verified = buildResidentNote(verifiedJob());
  assert.ok(verified.includes("has been completed and verified"), verified);

  const unverified = buildResidentNote(verifiedJob({ verificationConfirmed: false, verifiedAt: null, status: "in_progress" }));
  assert.ok(!unverified.includes("completed"), unverified);
  assert.ok(unverified.includes("not finished yet"), unverified);

  const onHold = buildResidentNote({
    status: "waiting_parts", holdReason: null, vendorName: null,
    nextAction: "Install the part as soon as it arrives",
    verificationConfirmed: false, verifiedAt: null,
  });
  assert.ok(!onHold.includes("completed"), onHold);
  assert.ok(onHold.includes("waiting for the arrival of the required parts"), onHold);
  assert.ok(onHold.includes("Next step: Install the part as soon as it arrives."), onHold);
});

test("notes: option lists are ES label → EN fragment pairs", () => {
  for (const list of [NOTE_FINDING_OPTIONS, NOTE_ACTION_OPTIONS, NOTE_TEST_OPTIONS]) {
    assert.ok(list.length >= 5);
    const keys = new Set();
    for (const option of list) {
      assert.ok(option.key && option.es && option.en, JSON.stringify(option));
      assert.ok(!keys.has(option.key), option.key);
      keys.add(option.key);
      // No fragment may smuggle in a completion claim.
      assert.ok(!/completed/i.test(option.en), option.en);
    }
  }
});

// ---------------------------------------------------------------------------
// notesFingerprint — stable, and sensitive to the note-feeding facts.
// ---------------------------------------------------------------------------
test("notesFingerprint is stable and changes when status or findings change", () => {
  const base = verifiedJob();
  assert.equal(notesFingerprint(base), notesFingerprint({ ...base }));
  assert.notEqual(notesFingerprint(base), notesFingerprint(verifiedJob({ status: "in_progress" })));
  assert.notEqual(notesFingerprint(base), notesFingerprint(verifiedJob({ findings: "Different finding" })));
  assert.notEqual(notesFingerprint(base), notesFingerprint(verifiedJob({ actionPerformed: "Other work" })));
  assert.notEqual(notesFingerprint(base), notesFingerprint(verifiedJob({ holdReason: "Now waiting" })));
  assert.notEqual(notesFingerprint(base), notesFingerprint(verifiedJob({ nextAction: "Follow up Friday" })));
  // Fields that do not feed the notes do not move the fingerprint.
  assert.equal(notesFingerprint(base), notesFingerprint(verifiedJob({ title: "Renamed job" })));
});

// ---------------------------------------------------------------------------
// Static contract: the Phase 5 migration.
// ---------------------------------------------------------------------------
test("contract: migration is additive and contains the Phase 5 schema", () => {
  const migration = read("supabase/migrations/20261109200000_centro_operaciones.sql");
  assert.ok(!/drop table/i.test(migration), "no table drops");
  assert.ok(!/drop column/i.test(migration), "no column drops");

  for (const table of ["work_order_collaborators", "work_order_history", "work_order_attachments", "job_quotes", "vendor_visits", "inspection_readings"]) {
    assert.ok(migration.includes(`create table if not exists public.${table}`), table);
    assert.ok(migration.includes(`revoke all on public.${table} from anon, authenticated`), table);
    assert.ok(migration.includes(`${table}_server_only`), table);
    assert.ok(migration.includes(`alter table public.${table} enable row level security`), table);
  }

  // Work order growth: every contract column is present.
  for (const column of [
    "record_type", "origin", "external_ref", "building", "unit", "scheduled_date",
    "findings", "cause", "action_performed", "next_action",
    "hold_reason", "hold_follow_up_date", "hold_follow_up_by",
    "verification_action", "verification_test", "verification_result", "verification_confirmed",
    "verified_by_member_id", "verified_by_user_id", "verified_at", "vendor_id",
    "maintenance_comment_draft", "resident_note_draft", "notes_fingerprint",
    "notes_updated_at", "notes_updated_by", "version",
  ]) {
    assert.ok(migration.includes(column), column);
  }

  // Widened CHECKs keep every previously valid value valid.
  for (const value of ["'open'", "'assigned'", "'in_progress'", "'on_hold'", "'completed'", "'waiting_vendor'", "'waiting_parts'", "'waiting_resident'"]) {
    assert.ok(migration.includes(value), value);
  }
  for (const value of ["'daily'", "'weekly'", "'monthly'", "'quarterly'", "'annual'", "'custom'", "'none'", "'semiannual'"]) {
    assert.ok(migration.includes(value), value);
  }
  for (const value of ["'visit_created'", "'visit_updated'", "'visit_rescheduled'", "'visit_completed'", "'visit_cancelled'", "'job_created'", "'job_verified'"]) {
    assert.ok(migration.includes(value), value);
  }
  // The legacy 'assigned' rows are converted, not lost.
  assert.ok(migration.includes("set status = 'open'"));
  assert.ok(migration.includes("where status = 'assigned'"));

  // History action vocabulary from the contract.
  for (const action of [
    "created", "details_updated", "status_changed", "assigned", "hold_set", "hold_cleared",
    "verification_recorded", "completed", "reopened", "cost_updated", "quote_added",
    "quote_updated", "note_draft_saved", "attachment_added", "collaborator_added", "collaborator_removed",
  ]) {
    assert.ok(migration.includes(`'${action}'`), action);
  }

  // Quotes need at least one parent; visits carry the compliance fields.
  assert.ok(migration.includes("check (work_order_id is not null or vendor_visit_id is not null)"));
  for (const column of ["compliance_status", "compliance_due_date", "netvendor_ref", "confirmation_status", "completed_visit"]) {
    assert.ok(migration.includes(column), column);
  }

  // Inventory purchasing references.
  for (const column of ["sku", "unit_cost", "gl_code", "quote_ref", "po_number"]) {
    assert.ok(migration.includes(column), column);
  }

  // Attachment classification lands on all four attachment tables.
  for (const table of ["log_attachments", "inspection_attachments", "vendor_attachments", "work_order_attachments"]) {
    assert.ok(migration.includes(table), table);
  }
  assert.ok((migration.match(/check \(phase in \('before', 'during', 'after'\)\)/g) || []).length >= 4);

  // Contract indexes.
  assert.ok(migration.includes("on public.work_orders (status, due_date)"));
  assert.ok(migration.includes("on public.vendor_visits (visit_date)"));
  assert.ok(migration.includes("on public.job_quotes (work_order_id)"));

  // The jobs bucket is created NOT public, with the server-only policy.
  assert.ok(migration.includes("insert into storage.buckets"));
  assert.ok(migration.includes("values ('jobs', 'jobs', false)"));
  assert.ok(migration.includes("jobs_bucket_server_only"));
});
