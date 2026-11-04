/**
 * End-to-end verification for access model v2 — REQUIRES A DISPOSABLE
 * STAGING ENVIRONMENT. Never point this at production: it creates test
 * accounts and work orders.
 *
 * Status: PENDING — no staging Supabase project exists yet for this app.
 * This harness is ready to run the day one is created (free tier is fine).
 * Until it runs green, the end-to-end halves of the six mandatory checks
 * must be reported as NOT YET VERIFIED (see docs/access-model-verification.md).
 *
 * Setup (staging only):
 *   1. Create a throwaway Supabase project; run every file in
 *      supabase/migrations/ in order; deploy this branch to a staging URL
 *      (or run `pnpm build && pnpm start` locally against the staging env).
 *   2. Sign up the administrator account in the staging app, then run
 *      docs/admin-bootstrap.sql in the staging SQL editor (with the staging
 *      admin email substituted in the script's constant).
 *   3. Export:
 *        E2E_APP_URL=https://staging.example.com
 *        E2E_SUPABASE_URL=https://<staging-ref>.supabase.co
 *        E2E_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
 *        E2E_SUPABASE_SECRET_KEY=<staging secret key>
 *        E2E_ADMIN_EMAIL=<staging admin email>
 *        E2E_ADMIN_PASSWORD=<staging admin password>
 *   4. Run: node scripts/e2e-access-model.mjs
 *
 * Sessions are passed to the app exactly the way the browser does: the
 * @supabase/ssr cookie `sb-<ref>-auth-token` carrying
 * `base64-<base64url(JSON session)>`. Sessions larger than one cookie chunk
 * are not handled; test users keep sessions small.
 */
import { createClient } from "@supabase/supabase-js";

const required = [
  "E2E_APP_URL", "E2E_SUPABASE_URL", "E2E_SUPABASE_PUBLISHABLE_KEY",
  "E2E_SUPABASE_SECRET_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.log(`SKIPPED: missing staging env vars: ${missing.join(", ")}`);
  console.log("End-to-end access-model checks remain PENDING until a disposable staging project exists.");
  process.exit(0);
}

const APP = process.env.E2E_APP_URL.replace(/\/$/, "");
const URL_ = process.env.E2E_SUPABASE_URL;
const ref = new URL(URL_).hostname.split(".")[0];
const anon = createClient(URL_, process.env.E2E_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const admin = createClient(URL_, process.env.E2E_SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(label, condition, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!condition) failures += 1;
}

function cookieHeader(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return { cookie: `sb-${ref}-auth-token=${value}`, "content-type": "application/json" };
}

async function api(session, body) {
  const res = await fetch(`${APP}/api/dashboard`, {
    method: body ? "POST" : "GET",
    headers: cookieHeader(session),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function signUp(email, password, jobTitle) {
  const { data, error } = await anon.auth.signUp({
    email, password, options: { data: { full_name: email.split("@")[0], job_title: jobTitle, phone: "+1 352 555 0100" } },
  });
  if (error) throw error;
  if (data.session) return data.session;
  const { data: signed, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return signed.session;
}

async function signIn(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

const stamp = Date.now();
const password = "Staging-Test-123!";
const pendingUser = { email: `e2e-pending-${stamp}@example.com`, jobTitle: "Admin" }; // titled "Admin" on purpose (check 2)
const techUser = { email: `e2e-tech-${stamp}@example.com`, jobTitle: "Maintenance Technician" };
const managerUser = { email: `e2e-mgr-${stamp}@example.com`, jobTitle: "Property Manager" };

const adminSession = await signIn(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
const pendingSession = await signUp(pendingUser.email, password, pendingUser.jobTitle);
const techSession = await signUp(techUser.email, password, techUser.jobTitle);
const managerSession = await signUp(managerUser.email, password, managerUser.jobTitle);

// Check 1: a pending account receives no data and 403 on data actions.
{
  const boot = await api(pendingSession);
  check("1a pending bootstrap contains no team/jobs", boot.json.team?.length === 0 && boot.json.jobs?.length === 0);
  const attempt = await api(pendingSession, { action: "create_job", title: "x", description: "y" });
  check("1b pending create_job is 403", attempt.status === 403);
}
// Check 2: job title "Admin" grants nothing — approve the 'Admin'-titled
// user later and verify admin actions stay forbidden; first, while pending,
// an admin action attempt must be 403.
{
  const attempt = await api(pendingSession, { action: "approve_member", id: 1 });
  check("2 pending 'Admin'-titled user cannot approve anyone", attempt.status === 403);
}

// Administrator approves both working users through the real API.
async function memberIdByEmail(email) {
  const { data, error } = await admin.from("members").select("id").eq("email", email).single();
  if (error) throw error;
  return data.id;
}
const techId = await memberIdByEmail(techUser.email);
const managerId = await memberIdByEmail(managerUser.email);
const pendingId = await memberIdByEmail(pendingUser.email);
for (const id of [techId, managerId, pendingId]) {
  const res = await api(adminSession, { action: "approve_member", id });
  check(`approve member ${id} by admin`, res.status === 200);
}

// Check 3: two approved users with different titles create and close WOs.
let jobId;
{
  const created = await api(techSession, { action: "create_job", title: "E2E leak", description: "Test job", assignedTo: managerId });
  check("3a approved technician-titled user creates a WO", created.status === 200 && Boolean(created.json.job?.id));
  jobId = created.json.job?.id;
  const closed = await api(managerSession, { action: "update_job", id: jobId, status: "completed", completionComment: "Done" });
  check("3b approved manager-titled user closes that WO", closed.status === 200);
  const reopen = await api(techSession, { action: "update_job", id: jobId, status: "in_progress" });
  check("3c creator can reopen/update the WO afterwards", reopen.status === 200);
}
// Check 2 (second half): the approved 'Admin'-titled user still cannot administer.
{
  const attempt = await api(pendingSession, { action: "suspend_member", id: techId });
  check("2b approved 'Admin'-titled user cannot suspend anyone", attempt.status === 403);
}
// Check 4: regular users cannot administer nor delete history.
{
  const attempt = await api(techSession, { action: "reject_member", id: managerId });
  check("4a regular approved user cannot reject accounts", attempt.status === 403);
  const del = await api(techSession, { action: "delete_job", id: jobId });
  check("4b no delete action exists for work orders", del.status === 400);
  const { data } = await admin.from("admin_audit_log").select("id").eq("action", "approve_member").limit(1);
  check("4c administrative actions were written to the audit log", (data?.length || 0) > 0);
}
// Check 5: suspension kills an open session's access on the next request.
{
  const before = await api(techSession);
  check("5a session works before suspension", before.status === 200 && before.json.accessState === "approved");
  const suspended = await api(adminSession, { action: "suspend_member", id: techId });
  check("5b admin suspends the user", suspended.status === 200);
  const after = await api(techSession, { action: "create_job", title: "x", description: "y" });
  check("5c same open session now gets 403", after.status === 403);
  const boot = await api(techSession);
  check("5d same session bootstrap shows suspended, no data", boot.json.accessState === "suspended" && boot.json.jobs?.length === 0);
}
// Check 6: the administrator keeps exclusive control; nobody else ever
// appears flagged, and the admin cannot be acted on by others.
{
  const { data } = await admin.from("members").select("email,is_admin").eq("is_admin", true);
  check("6 exactly one admin exists and it is the bootstrapped account",
    data?.length === 1 && data[0].email === process.env.E2E_ADMIN_EMAIL.toLowerCase());
  const selfAttempt = await api(adminSession, { action: "suspend_member", id: await memberIdByEmail(process.env.E2E_ADMIN_EMAIL) });
  check("6b even the admin cannot suspend themselves via the API", selfAttempt.status === 400);
}

console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
