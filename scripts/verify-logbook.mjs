/**
 * Executable verification for the property logbook (Phase 2).
 *
 * Run:  node --test scripts/verify-logbook.mjs
 *   or: pnpm verify:logbook
 *
 * Two layers are exercised FOR REAL here:
 *  1. Decision tests — the production rules are imported from
 *     lib/logbook-rules.ts (the exact module the API routes use) and
 *     checked against the Phase 2 acceptance criteria at the decision
 *     level. The suite also asserts lib/logbook-rules.ts and
 *     lib/access-rules.ts agree on operational access for every account
 *     state, so the modules cannot silently drift apart.
 *  2. Static contract tests — the shipped source is scanned for the
 *     structural guarantees the module depends on (additive migration
 *     with the private bucket and deny-by-default RLS, atomic folio
 *     function restricted to the server, per-request approval gate,
 *     append-only history with NO mutation path, comments that are never
 *     edited or deleted, signed-URL downloads only, stored notifications
 *     on assignment and comment, overdue follow-ups computed at read).
 *
 * What this suite does NOT prove: live HTTP behavior against a real
 * Supabase (a pending account receiving 403s end to end, a real photo
 * going up to the private "logbook" bucket and back down through a
 * signed URL, a full case chain round-trip, notifications persisting).
 * Those need the disposable staging Supabase project with the Phase 0 +
 * 1 + 2 migrations applied and remain PENDING until the staging E2E runs
 * — the same staging the Phase 0 harness (scripts/e2e-access-model.mjs)
 * is waiting for. Do not report the end-to-end checks as passed until
 * they run green against staging. See docs/logbook.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isApprovedAccess } from "../lib/access-rules.ts";
import {
  assignmentNotificationRecipients,
  canAccessLogbook,
  canAttach,
  canCloseEvent,
  canComment,
  canCreateEvent,
  canDownloadAttachment,
  canLinkEvents,
  canReopenEvent,
  canUpdateEvent,
  canVerifyEvent,
  commentNotificationRecipients,
  isFollowUpOverdue,
  isLogbookOperational,
} from "../lib/logbook-rules.ts";

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
  ["canAccessLogbook", (m) => canAccessLogbook(m)],
  ["canCreateEvent", (m) => canCreateEvent(m)],
  ["canUpdateEvent", (m) => canUpdateEvent(m)],
  ["canComment", (m) => canComment(m)],
  ["canAttach", (m) => canAttach(m)],
  ["canDownloadAttachment", (m) => canDownloadAttachment(m)],
  ["canLinkEvents", (m) => canLinkEvents(m)],
];

// ---------------------------------------------------------------------------
// The logbook operational primitive mirrors access model v2 on every state.
// ---------------------------------------------------------------------------
test("logbook primitive agrees with access model v2 on every account state", () => {
  const states = [
    ...NON_APPROVED.map((approval_status) => ({ approval_status, active: false, is_admin: false })),
    { approval_status: "approved", active: false, is_admin: false },
    { approval_status: "approved", active: true, is_admin: false },
    { approval_status: "approved", active: true, is_admin: true },
    { approval_status: "pending", active: false, is_admin: true },
    { approval_status: "suspended", active: false, is_admin: true },
  ];
  for (const state of states) {
    assert.equal(isLogbookOperational(state), isApprovedAccess(state), JSON.stringify(state));
  }
});

// ---------------------------------------------------------------------------
// Phase 2 criterion 1 — a pending (or rejected / suspended / revoked)
// account can neither read nor write anything in the logbook. Decision
// level: every non-approved state fails every decision. (HTTP 403
// behavior: staging E2E, pending.)
// ---------------------------------------------------------------------------
test("1. Non-approved accounts get nothing from the logbook", () => {
  for (const status of NON_APPROVED) {
    const person = member({ approval_status: status });
    for (const [name, decide] of ALL_DECISIONS) {
      assert.equal(decide(person), false, `${status}/${name}`);
    }
    assert.equal(canCloseEvent(person, { status: "open" }, "Done"), false, status);
    assert.equal(canReopenEvent(person, { status: "closed" }), false, status);
    assert.equal(canVerifyEvent(person, { status: "closed", verified_by_member_id: null }), false, status);
  }
  // Approved on paper but deactivated (suspension) is also out — even
  // with the admin flag set.
  const suspendedAdmin = member({ approval_status: "approved", active: false, is_admin: true });
  for (const [, decide] of ALL_DECISIONS) assert.equal(decide(suspendedAdmin), false);
});

// ---------------------------------------------------------------------------
// Phase 2 criterion 2 — every approved account operates identically,
// whatever its job title says, and the administrator flag grants nothing
// extra in this operational module.
// ---------------------------------------------------------------------------
test("2. Approved accounts share identical operational permissions; titles and the admin flag change nothing", () => {
  for (const job_title of ["Maintenance Technician", "Admin", "Manager", "Service Supervisor"]) {
    const person = approved({ job_title, is_admin: job_title === "Admin" });
    for (const [name, decide] of ALL_DECISIONS) {
      assert.equal(decide(person), true, `${job_title}/${name}`);
    }
  }
  const plain = approved({ is_admin: false });
  const boss = approved({ is_admin: true });
  for (const [, decide] of ALL_DECISIONS) assert.equal(decide(plain), decide(boss));
  assert.equal(
    canCloseEvent(plain, { status: "open" }, "Repaired"),
    canCloseEvent(boss, { status: "open" }, "Repaired"),
  );
});

// ---------------------------------------------------------------------------
// Phase 2 criterion 3 — closing requires a final result, closing is not
// deleting, and verification is a separate act on a closed event.
// ---------------------------------------------------------------------------
test("3. Close requires a final result; reopen and verify follow the state machine", () => {
  const tech = approved();
  assert.equal(canCloseEvent(tech, { status: "open" }, "Fixed and tested"), true);
  assert.equal(canCloseEvent(tech, { status: "in_progress" }, "Fixed"), true);
  assert.equal(canCloseEvent(tech, { status: "open" }, ""), false);
  assert.equal(canCloseEvent(tech, { status: "open" }, "   "), false);
  assert.equal(canCloseEvent(tech, { status: "open" }, null), false);
  assert.equal(canCloseEvent(tech, { status: "closed" }, "Again"), false);
  assert.equal(canReopenEvent(tech, { status: "closed" }), true);
  assert.equal(canReopenEvent(tech, { status: "open" }), false);
  assert.equal(canVerifyEvent(tech, { status: "closed", verified_by_member_id: null }), true);
  assert.equal(canVerifyEvent(tech, { status: "closed", verified_by_member_id: 7 }), false);
  assert.equal(canVerifyEvent(tech, { status: "open", verified_by_member_id: null }), false);
});

// ---------------------------------------------------------------------------
// Phase 2 criterion 4 — overdue follow-ups are computed at read time from
// the follow-up date and the open/closed state. Nothing is stored, so
// nothing can go stale.
// ---------------------------------------------------------------------------
test("4. Overdue follow-ups are computed at read time", () => {
  const today = "2026-11-03";
  assert.equal(isFollowUpOverdue({ status: "open", follow_up_date: "2026-11-01" }, today), true);
  assert.equal(isFollowUpOverdue({ status: "pending", follow_up_date: "2026-10-30" }, today), true);
  assert.equal(isFollowUpOverdue({ status: "in_progress", follow_up_date: "2026-11-02" }, today), true);
  assert.equal(isFollowUpOverdue({ status: "closed", follow_up_date: "2026-11-01" }, today), false);
  assert.equal(isFollowUpOverdue({ status: "open", follow_up_date: "2026-11-03" }, today), false);
  assert.equal(isFollowUpOverdue({ status: "open", follow_up_date: "2026-11-04" }, today), false);
  assert.equal(isFollowUpOverdue({ status: "open", follow_up_date: null }, today), false);
});

// ---------------------------------------------------------------------------
// Phase 2 criterion 5 — stored notifications are generated exactly on
// assignment (to the assignee) and on comment (to the reporter and the
// responsible member), never to the actor and never to bystanders.
// ---------------------------------------------------------------------------
test("5. Notifications go to the assignee / reporter / responsible — never to the actor", () => {
  assert.deepEqual(assignmentNotificationRecipients(1, 2), [2]);
  assert.deepEqual(assignmentNotificationRecipients(1, 1), []);
  assert.deepEqual(assignmentNotificationRecipients(1, null), []);
  const event = { reported_by_member_id: 3, responsible_member_id: 4 };
  assert.deepEqual(commentNotificationRecipients(9, event).sort(), [3, 4]);
  assert.deepEqual(commentNotificationRecipients(3, event), [4]);
  assert.deepEqual(commentNotificationRecipients(4, event), [3]);
  assert.deepEqual(
    commentNotificationRecipients(9, { reported_by_member_id: 3, responsible_member_id: 3 }),
    [3],
  );
  assert.deepEqual(
    commentNotificationRecipients(9, { reported_by_member_id: null, responsible_member_id: null }),
    [],
  );
});

// ---------------------------------------------------------------------------
// Static contract tests over the shipped source.
// ---------------------------------------------------------------------------
test("contract: migration creates the logbook schema, the folio function and the PRIVATE bucket", () => {
  const migration = read("supabase/migrations/20261103230000_logbook.sql");
  for (const table of ["log_folio_counters", "log_events", "log_event_links", "log_comments", "log_history", "log_attachments", "notifications"]) {
    assert.ok(migration.includes(`create table if not exists public.${table}`), table);
    assert.ok(migration.includes(`revoke all on public.${table} from anon, authenticated`), table);
    assert.ok(migration.includes(`${table}_server_only`), table);
  }
  // The event keeps the event datetime separate from the registration
  // timestamp, and the closure/verification trail columns exist.
  for (const column of ["folio", "occurred_at", "reported_by_member_id", "responsible_member_id", "follow_up_date", "final_result", "verified_by_member_id", "verified_at", "official_wo_ref", "closed_by_member_id", "closed_at"]) {
    assert.ok(migration.includes(column), column);
  }
  // The case chain: both link columns + no self-links + no duplicate links.
  assert.ok(migration.includes("unique (event_id, related_event_id)"));
  assert.ok(migration.includes("check (event_id <> related_event_id)"));
  // Atomic folio minting, callable only by the server.
  assert.ok(migration.includes("create or replace function public.next_log_folio_number"));
  assert.ok(migration.includes("revoke all on function public.next_log_folio_number(integer)"));
  assert.ok(migration.includes("from public, anon, authenticated"));
  // The bucket is created NOT public.
  assert.ok(migration.includes("insert into storage.buckets"));
  assert.ok(migration.includes("values ('logbook', 'logbook', false)"));
  assert.ok(migration.includes("logbook_bucket_server_only"));
  // Additive only.
  assert.ok(!/drop table/i.test(migration));
  assert.ok(!/drop column/i.test(migration));
});

test("contract: history is append-only — the API has no update/delete path for it or for comments", () => {
  const route = read("app/api/logbook/route.ts");
  // The only history write in the whole module is the insert helper.
  assert.ok(route.includes('from("log_history").insert'));
  assert.ok(!route.includes('.from("log_history").update'));
  assert.ok(!route.includes('.from("log_history").delete'));
  // Comments can be created, never edited or deleted.
  assert.ok(route.includes('from("log_comments").insert'));
  assert.ok(!route.includes('.from("log_comments").update'));
  assert.ok(!route.includes('.from("log_comments").delete'));
  // Events, links and attachment records are never deleted either.
  assert.ok(!route.includes('.from("log_events").delete'));
  assert.ok(!route.includes('.from("log_event_links").delete'));
  assert.ok(!route.includes('.from("log_attachments").delete'));
  // Every mutation records its history entry through the one helper.
  assert.ok(route.includes("writeHistory"));
  for (const action of ['"created"', '"status_changed"', '"assigned"', '"priority_changed"', '"follow_up_changed"', '"closed"', '"reopened"', '"verified"', '"comment_added"', '"attachment_added"', '"linked"', '"details_updated"']) {
    assert.ok(route.includes(action), action);
  }
});

test("contract: logbook API gates per request and notifies on assignment and comment", () => {
  const route = read("app/api/logbook/route.ts");
  assert.ok(route.includes("getCurrentMember()"));
  assert.ok(route.includes("canAccessLogbook(me)"));
  assert.ok(route.includes('throw new Error("APPROVAL_REQUIRED")'));
  for (const action of ["create_event", "update_event", "set_status", "assign", "set_priority", "set_follow_up", "close_event", "reopen_event", "verify_event", "add_comment", "link_event", "upload_attachment", "mark_notifications_read"]) {
    assert.ok(route.includes(`"${action}"`), action);
  }
  // Folios are minted by the database function, never by string math over
  // a count the client could race.
  assert.ok(route.includes('rpc("next_log_folio_number"'));
  assert.ok(route.includes("BIT-"));
  // Stored notifications are inserted on assignment and on comment, using
  // the pure recipient rules.
  assert.ok(route.includes('from("notifications").insert'));
  assert.ok(route.includes("assignmentNotificationRecipients"));
  assert.ok(route.includes("commentNotificationRecipients"));
  // Overdue follow-ups are computed at read time via the pure rule.
  assert.ok(route.includes("isFollowUpOverdue"));
});

test("contract: attachment downloads only happen through the signed-URL route after checks", () => {
  const download = read("app/api/logbook/download/route.ts");
  assert.ok(download.includes("getCurrentMember()"));
  assert.ok(download.includes("canDownloadAttachment"));
  assert.ok(download.includes("createSignedUrl"));
  // Short-lived: two minutes.
  assert.ok(download.includes("SIGNED_URL_SECONDS = 120"));
  // The main API never mints download URLs itself.
  const route = read("app/api/logbook/route.ts");
  assert.ok(!route.includes("createSignedUrl"));
  assert.ok(!route.includes("getPublicUrl"));
});

test("contract: the dashboard exposes the logbook tab and the Hoy attention card", () => {
  const dash = read("app/dashboard.tsx");
  assert.ok(dash.includes("LogbookPanel"));
  assert.ok(dash.includes("LogbookTodayCard"));
  assert.ok(dash.includes('"logbook"'));
  const panel = read("app/logbook-panel.tsx");
  // The summary card reads only the summary endpoint.
  assert.ok(panel.includes("/api/logbook?summary=1"));
});
