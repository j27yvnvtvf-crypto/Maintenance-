/**
 * Phase 3B verification — shop, inventory & assets, vendors & pendings,
 * and the training records that feed the remaining print formats.
 *
 *   node --test scripts/verify-inventory-vendors.mjs
 *
 * Two layers, same split as the earlier phases:
 *
 * 1. DECISION TESTS run the real lib/inventory-vendors-rules.ts (the
 *    exact functions the APIs call) against fixtures:
 *      - permission matrix: unapproved accounts can do nothing; the
 *        module agrees with the Phase 0 access model; approved accounts
 *        operate in EQUALITY (a free-text job_title of "Admin" grants
 *        nothing and removes nothing);
 *      - SOP 5025 color categories are exactly the ten Jose dictated,
 *        as fixed constants with bilingual labels;
 *      - stock movements: in / out / signed adjustment, never negative,
 *        and the ledger always reconciles with the stock on hand;
 *      - reorder at the minimum without duplicates, lifecycle
 *        pending → ordered → received;
 *      - tool loan / return states;
 *      - refrigerant entries must move some gas (generic structure —
 *        the official form is still pending Jose's document);
 *      - vendor pendings, completion and one-time verification with
 *        the verifier recorded; next-action overdue computed at read.
 *
 * 2. STATIC CONTRACTS read the migration, the API routes, the print
 *    page, the panels and the dashboard to prove the server-side
 *    properties the rules assume: member re-checked on every request,
 *    stock editable ONLY through the movements ledger, append-only
 *    histories (no deletes), private "vendors" bucket with 120-second
 *    signed downloads, NO seeded inventory / assets / vendors (the
 *    system ships empty — the team loads its real data), the logbook
 *    born-asset link that leaves Phase 2 untouched, and the three
 *    print formats now fed by real data with the blank template kept
 *    behind ?blank=1.
 *
 * What this suite is NOT: an end-to-end HTTP test against a live
 * Supabase. That run (real accounts on the staging project) is still
 * pending — staging deployment is tracked separately and reported
 * honestly in the phase PR.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const rules = await import("../lib/inventory-vendors-rules.ts");
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

const item = (over = {}) => ({
  quantity_on_hand: 10, min_quantity: 2, status: "active", ...over,
});
const job = (over = {}) => ({
  kind: "pending_part", status: "open", verified_by_member_id: null,
  next_action_date: null, ...over,
});

/* ------------------------------------------------------------------ */
/* 1. Decision tests                                                   */
/* ------------------------------------------------------------------ */

test("permission matrix: unapproved accounts can do nothing anywhere", () => {
  for (const status of ["unregistered", "pending", "rejected", "suspended", "revoked"]) {
    const m = member({ approval_status: status });
    assert.equal(rules.isPhase3BOperational(m), false, status);
    assert.equal(rules.canAccessShop(m), false, status);
    assert.equal(rules.canAccessVendors(m), false, status);
    assert.equal(rules.canDownloadVendorAttachment(m), false, status);
    assert.equal(rules.canCompleteVendorJob(m, job()), false, status);
    assert.equal(rules.canVerifyVendorJob(m, job({ status: "completed" })), false, status);
  }
  const inactive = member({ active: false });
  assert.equal(rules.isPhase3BOperational(inactive), false);
  assert.equal(rules.canAccessShop(null), false);
  assert.equal(rules.canAccessVendors(undefined), false);
});

test("permission matrix: this module agrees with the Phase 0 access model", () => {
  for (const status of ["unregistered", "pending", "approved", "rejected", "suspended", "revoked"]) {
    for (const active of [true, false]) {
      const m = member({ approval_status: status, active });
      assert.equal(rules.isPhase3BOperational(m), access.isApprovedAccess(m), `${status}/${active}`);
    }
  }
});

test("approved accounts operate in equality — job title grants nothing", () => {
  const techA = member({ job_title: "Maintenance Technician" });
  const techB = member({ job_title: "Service Supervisor" });
  for (const m of [techA, techB, titledAdmin, admin]) {
    assert.equal(rules.canAccessShop(m), true);
    assert.equal(rules.canAccessVendors(m), true);
    assert.equal(rules.canDownloadVendorAttachment(m), true);
    assert.equal(rules.canCompleteVendorJob(m, job()), true);
  }
  // The module defines NO admin-only operational gate at all: shop and
  // vendor work is equal for every approved account (Phase 0 model).
  assert.equal(rules.canAccessShop(titledAdmin), rules.canAccessShop(techA));
});

test("SOP 5025 categories: exactly Jose's ten, as fixed constants", () => {
  assert.deepEqual(rules.SOP_COLOR_KEYS, [
    "paint_chemicals", "cleaning", "construction", "hardware", "lighting",
    "appliances", "electrical", "plumbing", "hvac", "safety",
  ]);
  assert.equal(rules.sopColorLabel("plumbing", "en"), "Blue — Plumbing");
  assert.equal(rules.sopColorLabel("plumbing", "es"), "Azul — Plomería");
  assert.equal(rules.sopColorLabel("paint_chemicals", "es"), "Amarillo — Pinturas y químicos");
  assert.equal(rules.sopColorLabel("safety", "en"), "Yellow (safety wall) — Safety");
  assert.equal(rules.sopColorLabel("safety", "es"), "Amarillo (muro de seguridad) — Seguridad");
  assert.equal(rules.sopColorLabel("cleaning", "en"), "Dark green — Cleaning");
});

test("stock movements: in / out / signed adjustment, never negative", () => {
  assert.equal(rules.applyMovement(10, "in", 5), 15);
  assert.equal(rules.applyMovement(10, "out", 4), 6);
  assert.equal(rules.applyMovement(10, "adjustment", -3), 7);
  assert.equal(rules.applyMovement(10, "adjustment", 2), 12);

  assert.equal(rules.isValidMovement(item(), "out", 10), true);
  assert.equal(rules.isValidMovement(item(), "out", 11), false, "cannot take out more than the shelf holds");
  assert.equal(rules.isValidMovement(item(), "in", 0), false, "zero is not a movement");
  assert.equal(rules.isValidMovement(item(), "in", -1), false);
  assert.equal(rules.isValidMovement(item(), "out", -1), false);
  assert.equal(rules.isValidMovement(item(), "adjustment", 0), false);
  assert.equal(rules.isValidMovement(item(), "adjustment", -10), true);
  assert.equal(rules.isValidMovement(item(), "adjustment", -11), false);
});

test("the ledger reconciles: the sum of movements IS the stock, history intact", () => {
  // Simulates the route's recordMovement: every accepted movement is
  // appended to the ledger and the stock is re-derived from it. No
  // step edits or removes a previous entry.
  const ledger = [];
  let stock = 0;
  const record = (type, quantity) => {
    const current = item({ quantity_on_hand: stock });
    assert.equal(rules.isValidMovement(current, type, quantity), true, `${type} ${quantity}`);
    ledger.push({ type, quantity });
    stock = rules.applyMovement(stock, type, quantity);
  };
  record("in", 24);
  record("out", 5);
  record("out", 3);
  record("adjustment", -1); // count correction, reason lives on the row
  record("in", 12);
  record("out", 20);
  const derived = ledger.reduce((sum, row) => rules.applyMovement(sum, row.type, row.quantity), 0);
  assert.equal(stock, 7);
  assert.equal(derived, stock, "replaying the append-only ledger reproduces the stock exactly");
  assert.equal(ledger.length, 6, "no movement was edited away");
});

test("reorder at the minimum: triggers once, never duplicates, suggestion is a default", () => {
  assert.equal(rules.isBelowMinimum(item({ quantity_on_hand: 2 })), true, "at the minimum counts");
  assert.equal(rules.isBelowMinimum(item({ quantity_on_hand: 3 })), false);
  assert.equal(rules.isBelowMinimum(item({ quantity_on_hand: 0, min_quantity: 0 })), false,
    "minimum 0 means no reorder policy");
  assert.equal(rules.needsAutoReorder(item({ quantity_on_hand: 1 }), false), true);
  assert.equal(rules.needsAutoReorder(item({ quantity_on_hand: 1 }), true), false,
    "an open request blocks a duplicate");
  assert.equal(rules.needsAutoReorder(item({ quantity_on_hand: 1, status: "archived" }), false), false);
  // Restock to twice the minimum: min 5, on hand 2 → order 8.
  assert.equal(rules.suggestedReorderQuantity(item({ quantity_on_hand: 2, min_quantity: 5 })), 8);
  assert.equal(rules.suggestedReorderQuantity(item({ quantity_on_hand: 9, min_quantity: 5 })), 0);
});

test("reorder lifecycle: pending → ordered → received (or cancelled)", () => {
  assert.equal(rules.canChangeReorderStatus("pending", "ordered"), true);
  assert.equal(rules.canChangeReorderStatus("pending", "cancelled"), true);
  assert.equal(rules.canChangeReorderStatus("pending", "received"), false, "must be ordered first");
  assert.equal(rules.canChangeReorderStatus("ordered", "received"), true);
  assert.equal(rules.canChangeReorderStatus("ordered", "cancelled"), true);
  assert.equal(rules.canChangeReorderStatus("received", "ordered"), false);
  assert.equal(rules.canChangeReorderStatus("cancelled", "pending"), false);
  assert.equal(rules.isOpenReorder("pending"), true);
  assert.equal(rules.isOpenReorder("ordered"), true);
  assert.equal(rules.isOpenReorder("received"), false);
});

test("tools: loan only when available, return only when loaned", () => {
  assert.equal(rules.canLoanTool({ status: "available" }), true);
  assert.equal(rules.canLoanTool({ status: "loaned" }), false);
  assert.equal(rules.canLoanTool({ status: "maintenance" }), false);
  assert.equal(rules.canLoanTool({ status: "retired" }), false);
  assert.equal(rules.canReturnTool({ status: "loaned" }), true);
  assert.equal(rules.canReturnTool({ status: "available" }), false);
});

test("refrigerant: an entry must move some gas, nothing negative", () => {
  assert.equal(rules.isValidRefrigerantEntry({ amount_added: 2.5, amount_recovered: 0 }), true);
  assert.equal(rules.isValidRefrigerantEntry({ amount_added: 0, amount_recovered: 1 }), true);
  assert.equal(rules.isValidRefrigerantEntry({ amount_added: 0, amount_recovered: 0 }), false);
  assert.equal(rules.isValidRefrigerantEntry({ amount_added: -1, amount_recovered: 2 }), false);
  assert.equal(rules.isValidRefrigerantEntry({ amount_added: Number.NaN, amount_recovered: 1 }), false);
});

test("assets: warranty state is computed at read time", () => {
  const today = "2026-06-01";
  assert.equal(rules.warrantyStatus({ warranty_end_date: "2026-06-02" }, today), "active");
  assert.equal(rules.warrantyStatus({ warranty_end_date: "2026-05-31" }, today), "expired");
  assert.equal(rules.warrantyStatus({ warranty_end_date: null }, today), null);
});

test("vendor pendings: pending kinds in non-final states are the pending list", () => {
  assert.equal(rules.isPendingVendorJob(job()), true);
  assert.equal(rules.isPendingVendorJob(job({ kind: "pending_service", status: "in_progress" })), true);
  assert.equal(rules.isPendingVendorJob(job({ kind: "pending_part", status: "completed" })), false);
  assert.equal(rules.isPendingVendorJob(job({ kind: "pending_part", status: "verified" })), false);
  assert.equal(rules.isPendingVendorJob(job({ kind: "request", status: "open" })), false,
    "requests are work, not pendings");
  assert.equal(rules.isPendingVendorJob(job({ kind: "quote", status: "open" })), false);
  assert.equal(rules.isVendorJobFinal("cancelled"), true);
  assert.equal(rules.isVendorJobFinal("scheduled"), false);
});

test("vendor completion and one-time verification, verifier recorded", () => {
  for (const status of ["open", "scheduled", "in_progress"]) {
    assert.equal(rules.canCompleteVendorJob(member(), job({ status })), true, status);
  }
  assert.equal(rules.canCompleteVendorJob(member(), job({ status: "completed" })), false);
  assert.equal(rules.canCompleteVendorJob(pending, job()), false);

  assert.equal(rules.canVerifyVendorJob(member(), job({ status: "completed" })), true);
  assert.equal(rules.canVerifyVendorJob(member(), job({ status: "open" })), false,
    "verification happens on completed work");
  assert.equal(rules.canVerifyVendorJob(member(), job({ status: "completed", verified_by_member_id: 7 })), false,
    "a recorded verifier blocks a second verification");
  assert.equal(rules.canVerifyVendorJob(member(), job({ status: "verified", verified_by_member_id: 7 })), false);
});

test("vendor next action: overdue is computed at read time, never stored", () => {
  const today = "2026-06-01";
  assert.equal(rules.isNextActionOverdue(job({ next_action_date: "2026-05-31" }), today), true);
  assert.equal(rules.isNextActionOverdue(job({ next_action_date: today }), today), false);
  assert.equal(rules.isNextActionOverdue(job({ next_action_date: "2026-05-31", status: "completed" }), today), false);
  assert.equal(rules.isNextActionOverdue(job({ next_action_date: null }), today), false);
});

/* ------------------------------------------------------------------ */
/* 2. Static contracts                                                 */
/* ------------------------------------------------------------------ */

const migration = read("supabase/migrations/20261103240000_inventory_vendors.sql");
const shopRoute = read("app/api/shop/route.ts");
const vendorsRoute = read("app/api/vendors/route.ts");
const downloadRoute = read("app/api/vendors/download/route.ts");
const logbookRoute = read("app/api/logbook/route.ts");
const printPage = read("app/print/[format]/page.tsx");
const dashboard = read("app/dashboard.tsx");
const shopPanel = read("app/shop-panel.tsx");
const vendorsPanel = read("app/vendors-panel.tsx");

const NEW_TABLES = [
  "inventory_items", "inventory_movements", "inventory_history", "reorder_requests",
  "tools", "tool_loans", "assets", "asset_links", "asset_history", "refrigerant_logs",
  "vendors", "vendor_jobs", "vendor_attachments", "vendor_history",
  "training_sessions", "training_attendees", "training_documents",
  "training_actions", "training_history",
];

test("migration: every new table is server-only; vendors bucket is private", () => {
  for (const table of NEW_TABLES) {
    assert.ok(migration.includes(`create table if not exists public.${table}`), table);
    assert.ok(migration.includes(`public.${table} enable row level security`), table);
    assert.ok(migration.includes(`${table}_server_only`), table);
  }
  assert.ok(migration.includes("'vendors', 'vendors', false"), "bucket must be private");
  // The SOP 5025 check constraint carries exactly Jose's ten keys.
  for (const key of rules.SOP_COLOR_KEYS) {
    assert.ok(migration.includes(`'${key}'`), key);
  }
  // Assets link to the logbook without breaking Phase 2: one new
  // nullable column, and manuals point at Library documents (no file
  // duplication).
  assert.ok(migration.includes("add column if not exists asset_id"));
  assert.ok(migration.includes("manual_document_id bigint references public.documents(id)"));
  // Append-only ledgers and histories exist for movements and audits.
  assert.ok(migration.includes("inventory_movements"));
  assert.ok(migration.includes("vendor_history"));
});

test("migration: NO seeded data and nothing destructive — the system ships empty", () => {
  for (const table of NEW_TABLES) {
    assert.ok(!new RegExp(`insert\\s+into\\s+public\\.${table}\\b`, "i").test(migration),
      `no seed rows for ${table}`);
  }
  assert.ok(!migration.includes("drop table"), "additive only");
  assert.ok(!migration.includes("drop column"), "additive only");
  // The refrigerant section of the migration itself states that the
  // official form is not available yet.
  assert.ok(/official form/i.test(migration), "refrigerant honesty note");
});

test("shop route: member re-checked per request; stock is ledger-only", () => {
  assert.ok(shopRoute.includes("canAccessShop"));
  assert.ok(shopRoute.includes("getCurrentMember"));
  // update_item refuses any quantity field: stock changes ONLY through
  // recorded movements.
  assert.ok(shopRoute.includes("Stock changes only through movements"));
  assert.ok(shopRoute.includes('from("inventory_movements").insert'));
  assert.ok(shopRoute.includes("needsAutoReorder"), "auto-reorder decision comes from the rules");
  assert.ok(shopRoute.includes('from("reorder_requests").insert'));
  // Receiving a reorder enters the units through the same ledger.
  assert.ok(shopRoute.includes("quantityReceived"));
  // No deletes of the ledger or of any history table.
  assert.ok(!/from\("(inventory_movements|inventory_history|asset_history|training_history|tool_loans)"\)\s*\.delete/.test(shopRoute));
  // Training pins document VERSIONS and never WRITES read confirmations:
  // that evidence stays owned by the Library (Phase 1). The route may
  // mention the table in comments, but it never queries or inserts it.
  assert.ok(shopRoute.includes("training_documents"));
  assert.ok(!/from\("document_reads"\)/.test(shopRoute), "read evidence is not duplicated");
});

test("vendors route: completion/verification through the rules; history append-only", () => {
  assert.ok(vendorsRoute.includes("canAccessVendors"));
  assert.ok(vendorsRoute.includes("canCompleteVendorJob"));
  assert.ok(vendorsRoute.includes("canVerifyVendorJob"));
  assert.ok(vendorsRoute.includes('from("vendor_history").insert'));
  assert.ok(vendorsRoute.includes('storage.from("vendors").upload'));
  assert.ok(!/from\("(vendor_history|vendor_attachments)"\)\s*\.delete/.test(vendorsRoute));
  assert.ok(!vendorsRoute.includes("createSignedUrl"), "downloads live in the download route only");
});

test("download route: signed URL is short-lived and approval-gated", () => {
  assert.ok(downloadRoute.includes("canDownloadVendorAttachment"));
  assert.ok(downloadRoute.includes("createSignedUrl"));
  assert.ok(downloadRoute.includes("120"), "120-second signed URLs");
  assert.ok(downloadRoute.includes('from("vendors")'));
});

test("logbook: events can be born linked to an asset; Phase 2 stays intact", () => {
  assert.ok(logbookRoute.includes("assetId"), "create_event accepts the optional asset link");
  assert.ok(logbookRoute.includes("asset_id: bornAssetId"));
  assert.ok(logbookRoute.includes('from("asset_history").insert'), "the link lands on the asset history");
  // The Phase 2 free-text equipment field and folio minting are untouched.
  assert.ok(logbookRoute.includes("equipment: textField(body.equipment, 160)"));
  assert.ok(logbookRoute.includes("next_log_folio_number"));
});

test("print formats: the three remaining formats read real data; blank template kept", () => {
  for (const format of ["pending-parts-vendors", "inventory-reorder", "training-log"]) {
    assert.ok(printPage.includes(`"${format}"`), format);
  }
  assert.ok(printPage.includes('from("vendor_jobs")'), "pending log reads vendor jobs");
  assert.ok(printPage.includes('from("reorder_requests")'), "reorder list reads reorder requests");
  assert.ok(printPage.includes('from("training_sessions")'), "training log reads sessions");
  assert.ok(printPage.includes("sopColorLabel"), "reorder list prints SOP 5025 color labels");
  assert.ok(printPage.includes('query.blank === "1"'), "the blank paper template stays available");
  // Earlier formats and their contracts are untouched.
  assert.ok(printPage.includes('from("work_orders")'));
  assert.ok(printPage.includes('eq("template_type", "shop_closing")'));
  assert.ok(printPage.includes("BlankRows"));
  assert.ok(printPage.includes("isApproved(member)"));
  assert.ok(printPage.includes('redirect("/login")'));
});

test("dashboard and panels: Shop and Vendors are wired in, honesty notes visible", () => {
  assert.ok(dashboard.includes("ShopPanel"));
  assert.ok(dashboard.includes("VendorsPanel"));
  assert.ok(dashboard.includes("ShopTodayCard"));
  assert.ok(dashboard.includes('"shop"'));
  assert.ok(dashboard.includes('"vendors"'));
  // The generic refrigerant structure is labelled as such in the UI —
  // it never claims to be the official form.
  assert.ok(shopPanel.includes("refrDisclaimer"));
  assert.ok(/official refrigerant form|formulario oficial de refrigerantes/.test(shopPanel));
  // Training points at the Library for read evidence instead of
  // duplicating it.
  assert.ok(shopPanel.includes("trainingNote"));
  assert.ok(vendorsPanel.includes("/api/vendors/download"), "attachments download through the gated route");
  assert.ok(shopPanel.includes("/print/inventory-reorder"));
  assert.ok(vendorsPanel.includes("/print/pending-parts-vendors"));
});
