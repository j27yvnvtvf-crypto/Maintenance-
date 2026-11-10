/**
 * End-to-end verification for Phase 5 — Centro de Operaciones de
 * The Darley — REQUIRES A DISPOSABLE STAGING ENVIRONMENT. Never point
 * this at production: it creates test accounts, work orders, a vendor,
 * a vendor visit, a quote and a photo attachment.
 *
 * Companion to scripts/verify-centro.mjs (decision + static contract
 * suite, runs anywhere). This suite proves the LIVE HTTP behavior that
 * suite cannot: hold/close gates returning 400 over the wire, the
 * optimistic-lock 409, a completed vendor visit leaving its work order
 * open, pending accounts receiving 403 from every Phase 5 route, and
 * the exports / KPIs carrying real data.
 *
 * Setup (staging only):
 *   1. Use the disposable staging Supabase project (ref
 *      mompihbzkhjqewstpquc); run every file in supabase/migrations/ in
 *      order; deploy this branch (feat/centro-operaciones) to the
 *      staging app (https://maintenance-staging.vercel.app) or run
 *      `pnpm build && pnpm start` locally against the staging env.
 *   2. Sign up the administrator account in the staging app, then run
 *      docs/admin-bootstrap.sql in the staging SQL editor (with the
 *      staging admin email substituted in the script's constant).
 *   3. Export (values come from the staging project only — never
 *      hardcode keys in this file):
 *        E2E_APP_URL=https://maintenance-staging.vercel.app
 *        E2E_SUPABASE_URL=https://mompihbzkhjqewstpquc.supabase.co
 *        E2E_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
 *        E2E_SUPABASE_SECRET_KEY=<staging secret key>
 *        E2E_ADMIN_EMAIL=<staging admin email>
 *        E2E_ADMIN_PASSWORD=<staging admin password>
 *   4. Run: node scripts/e2e-centro.mjs
 *
 * Sessions are passed to the app exactly the way the browser does: the
 * @supabase/ssr cookie `sb-<ref>-auth-token` carrying
 * `base64-<base64url(JSON session)>`. Sessions larger than one cookie
 * chunk are not handled; test users keep sessions small.
 */
import { createClient } from "@supabase/supabase-js";

const required = [
  "E2E_APP_URL", "E2E_SUPABASE_URL", "E2E_SUPABASE_PUBLISHABLE_KEY",
  "E2E_SUPABASE_SECRET_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.log(`SKIPPED: missing staging env vars: ${missing.join(", ")}`);
  console.log("End-to-end Centro de Operaciones checks remain PENDING until a disposable staging project exists.");
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

function cookieOnlyHeader(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return { cookie: `sb-${ref}-auth-token=${value}` };
}

/** JSON API call against any app route. No body means GET. */
async function api(session, path, body) {
  const res = await fetch(`${APP}${path}`, {
    method: body ? "POST" : "GET",
    headers: cookieHeader(session),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function dashboard(session, body) {
  return api(session, "/api/dashboard", body);
}

/** Raw call for non-JSON responses (CSV export). */
async function apiRaw(session, path) {
  const res = await fetch(`${APP}${path}`, {
    method: "GET",
    headers: cookieOnlyHeader(session),
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    text: await res.text(),
  };
}

/** Multipart call for photo upload: fetch sets the multipart boundary. */
async function apiMultipart(session, path, form) {
  const res = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: cookieOnlyHeader(session),
    body: form,
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

async function memberIdByEmail(email) {
  const { data, error } = await admin.from("members").select("id").eq("email", email).single();
  if (error) throw error;
  return data.id;
}

async function getJob(session, jobId) {
  const boot = await dashboard(session);
  return (boot.json.jobs || []).find((job) => job.id === jobId) || null;
}

function futureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const stamp = Date.now();
const password = "Staging-Test-123!";
const approvedUser = { email: `e2e-centro-approved-${stamp}@example.com`, jobTitle: "Maintenance Technician" };
const pendingUser = { email: `e2e-centro-pending-${stamp}@example.com`, jobTitle: "Maintenance Technician" };

const adminSession = await signIn(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
const approvedSession = await signUp(approvedUser.email, password, approvedUser.jobTitle);
const pendingSession = await signUp(pendingUser.email, password, pendingUser.jobTitle);

// Member rows materialize on each account's first app bootstrap (the same
// thing that happens when a real user opens the app after registering), so
// touch the API once per user before looking their rows up by email.
await dashboard(approvedSession);
await dashboard(pendingSession);

const approvedId = await memberIdByEmail(approvedUser.email);
const pendingId = await memberIdByEmail(pendingUser.email);
check("setup pending test user exists and stays pending", Boolean(pendingId));

// Administrator approves exactly one of the two test users through the
// real API; the other stays pending for check 1.
{
  const res = await dashboard(adminSession, { action: "approve_member", id: approvedId });
  check("setup admin approves the approved test user", res.status === 200);
}

// Check 1: a pending account receives no data and 403 from every
// Phase 5 data route.
{
  const boot = await dashboard(pendingSession);
  check("1a pending GET /api/dashboard is not approved and jobs=[]",
    boot.json.accessState !== "approved" && Array.isArray(boot.json.jobs) && boot.json.jobs.length === 0,
    `accessState=${boot.json.accessState}`);
  const centro = await api(pendingSession, "/api/centro");
  check("1b pending GET /api/centro is 403", centro.status === 403);
  const visits = await api(pendingSession, "/api/visits");
  check("1c pending GET /api/visits is 403", visits.status === 403);
  const photos = await api(pendingSession, "/api/photos");
  check("1d pending GET /api/photos is 403", photos.status === 403);
  const quotes = await api(pendingSession, "/api/quotes");
  check("1e pending GET /api/quotes is 403", quotes.status === 403);
}

// Check 2: an approved user creates a job with the structured Phase 5
// fields, and the created job echoes them back.
let jobId;
{
  const created = await dashboard(approvedSession, {
    action: "create_job",
    title: `E2E Centro WO ${stamp}`,
    description: "E2E Centro de Operaciones work order — staging only",
    recordType: "work_order",
    building: "2000",
    unit: "204",
    origin: "rmm_audit",
  });
  jobId = created.json.job?.id;
  check("2a approved user creates a job (POST create_job)", created.status === 200 && Boolean(jobId));
  check("2b created job echoes recordType/building/unit/origin",
    created.json.job?.recordType === "work_order"
      && created.json.job?.building === "2000"
      && created.json.job?.unit === "204"
      && created.json.job?.origin === "rmm_audit",
    `recordType=${created.json.job?.recordType} building=${created.json.job?.building} unit=${created.json.job?.unit} origin=${created.json.job?.origin}`);
}

// Check 3: a hold without its four recorded facts is rejected; with
// them it is accepted and visible on the dashboard.
{
  const rejected = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "waiting_parts",
  });
  check("3a hold without hold fields is 400 HOLD_FIELDS_REQUIRED",
    rejected.status === 400 && rejected.json.error === "HOLD_FIELDS_REQUIRED",
    `status=${rejected.status} error=${rejected.json.error}`);
  const hold = {
    holdReason: "Evaporator coil on order — E2E",
    holdFollowUpDate: futureDate(7),
    holdFollowUpBy: approvedId,
    nextAction: "Call the supplier to confirm the delivery date",
  };
  const accepted = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "waiting_parts", ...hold,
  });
  check("3b hold with holdReason/holdFollowUpDate/holdFollowUpBy/nextAction is 200",
    accepted.status === 200);
  const job = await getJob(approvedSession, jobId);
  check("3c dashboard shows the job in waiting_parts with the hold data",
    job?.status === "waiting_parts"
      && job?.holdReason === hold.holdReason
      && job?.holdFollowUpDate === hold.holdFollowUpDate
      && job?.holdFollowUpBy === approvedId
      && job?.nextAction === hold.nextAction,
    `status=${job?.status}`);
}

// Check 4: closing without a recorded verification is rejected and the
// job is still not completed afterwards.
{
  const rejected = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "completed",
  });
  check("4a close without verification is 400 VERIFICATION_REQUIRED",
    rejected.status === 400 && rejected.json.error === "VERIFICATION_REQUIRED",
    `status=${rejected.status} error=${rejected.json.error}`);
  const job = await getJob(approvedSession, jobId);
  check("4b job is still not completed after the rejected close", job?.status !== "completed",
    `status=${job?.status}`);
}

// Check 5: a closing with a complete recorded verification succeeds;
// the server stamps verifiedAt and verifiedByMemberId = the closer.
{
  const closed = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "completed",
    actionPerformed: "Replaced the evaporator coil and cleaned the drain line",
    verificationAction: "Final repair confirmed in unit",
    verificationTest: "Ran the system for 20 minutes",
    verificationResult: "Cooling normally, 68F supply air",
    verificationConfirmed: true,
  });
  check("5a valid close with verification is 200", closed.status === 200);
  const job = closed.json.job || await getJob(approvedSession, jobId);
  check("5b closed job shows status completed", job?.status === "completed");
  check("5c closed job has verifiedAt set", Boolean(job?.verifiedAt), `verifiedAt=${job?.verifiedAt}`);
  check("5d verifiedByMemberId is the closer (approved test user)",
    job?.verifiedByMemberId === approvedId,
    `verifiedByMemberId=${job?.verifiedByMemberId} expected=${approvedId}`);
}

// Check 6: reopening clears the verification; an immediate re-close
// without a fresh verificationConfirmed is rejected; the append-only
// history preserves both the completion and the reopening.
{
  const reopened = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "in_progress",
  });
  check("6a reopen to in_progress is 200", reopened.status === 200);
  const job = await getJob(approvedSession, jobId);
  check("6b reopened job has verifiedAt cleared", job?.status === "in_progress" && !job?.verifiedAt,
    `status=${job?.status} verifiedAt=${job?.verifiedAt}`);
  const reclose = await dashboard(approvedSession, {
    action: "update_job", id: jobId, status: "completed",
  });
  check("6c immediate re-close without fresh verificationConfirmed is 400",
    reclose.status === 400 && reclose.json.error === "VERIFICATION_REQUIRED",
    `status=${reclose.status} error=${reclose.json.error}`);
  const history = await dashboard(approvedSession, { action: "job_history", id: jobId });
  const actions = (history.json.history || []).map((entry) => entry.action);
  check("6d job_history contains 'completed' and 'reopened' entries (history preserved)",
    actions.includes("completed") && actions.includes("reopened"),
    `actions=${actions.join(",")}`);
}

// Check 7: optimistic locking — two saves against the same stale
// version: the first wins, the second is 409 VERSION_CONFLICT.
{
  const job = await getJob(approvedSession, jobId);
  const staleVersion = job?.version;
  check("7a job exposes a version to conflict on", Number.isInteger(staleVersion), `version=${staleVersion}`);
  const first = await dashboard(approvedSession, {
    action: "update_job", id: jobId, version: staleVersion,
    title: `E2E Centro WO ${stamp} (v1)`,
  });
  check("7b first update with the current version is 200", first.status === 200);
  const second = await dashboard(approvedSession, {
    action: "update_job", id: jobId, version: staleVersion,
    title: `E2E Centro WO ${stamp} (v2)`,
  });
  check("7c second update with the same stale version is 409 VERSION_CONFLICT",
    second.status === 409 && second.json.error === "VERSION_CONFLICT",
    `status=${second.status} error=${second.json.error}`);
}

// Check 8: a vendor visit is a record of its own — completing it does
// NOT close the linked work order (golden rule).
{
  const created = await dashboard(approvedSession, {
    action: "create_job",
    title: `E2E Centro visit WO ${stamp}`,
    description: "Open work order linked to a vendor visit — E2E staging only",
    recordType: "work_order",
    building: "1000",
    unit: "101",
    origin: "daily_operation",
  });
  const visitJobId = created.json.job?.id;
  check("8a open work order created for the visit", created.status === 200 && Boolean(visitJobId));

  // The vendors route has a create action (create_vendor); use it, and
  // fall back to a direct admin-client insert if it is unavailable.
  let vendorId;
  const vendorViaApi = await api(approvedSession, "/api/vendors", {
    action: "create_vendor", company: `E2E Centro Vendor ${stamp}`, specialty: "HVAC",
  });
  if (vendorViaApi.status === 200 && vendorViaApi.json.vendorId) {
    vendorId = vendorViaApi.json.vendorId;
  } else {
    const { data, error } = await admin.from("vendors")
      .insert({ company_name: `E2E Centro Vendor ${stamp}`, specialty: "HVAC", status: "active" })
      .select("id").single();
    if (error) throw error;
    vendorId = data.id;
  }
  check("8b vendor created (POST /api/vendors create_vendor or admin insert)", Boolean(vendorId));

  const visitCreated = await api(approvedSession, "/api/visits", {
    action: "create", vendorId, workOrderId: visitJobId,
    service: "E2E HVAC inspection", visitDate: futureDate(1),
  });
  const visitId = visitCreated.json.visitId;
  check("8c visit created via POST /api/visits {action:'create', workOrderId}",
    visitCreated.status === 200 && Boolean(visitId));

  const beforeJob = await getJob(approvedSession, visitJobId);
  const completed = await api(approvedSession, "/api/visits", {
    action: "complete_visit", id: visitId, result: "Vendor attended and inspected the unit",
  });
  check("8d complete_visit is 200", completed.status === 200);
  const visits = await api(approvedSession, `/api/visits?workOrderId=${visitJobId}`);
  const visit = (visits.json.visits || []).find((entry) => entry.id === visitId);
  check("8e visit status is completed_visit", visit?.status === "completed_visit",
    `status=${visit?.status}`);
  const afterJob = await getJob(approvedSession, visitJobId);
  check("8f linked work order status is unchanged (not completed)",
    afterJob?.status === beforeJob?.status && afterJob?.status !== "completed",
    `before=${beforeJob?.status} after=${afterJob?.status}`);
}

// Check 9: quotes carry quoted/authorized/real cost separately, and
// editing a quote's actualCost never touches the job's verified_*
// fields. The check-5 job is re-closed validly first.
let quoteId;
{
  const jobBefore = await getJob(approvedSession, jobId);
  if (jobBefore?.status !== "completed") {
    const reclosed = await dashboard(approvedSession, {
      action: "update_job", id: jobId, status: "completed",
      actionPerformed: "Re-checked the repair after reopening",
      verificationAction: "Final repair re-confirmed in unit",
      verificationTest: "Ran the system for 20 minutes again",
      verificationResult: "Cooling normally after re-check",
      verificationConfirmed: true,
    });
    check("9a job from check 5 re-closed validly for the quotes check", reclosed.status === 200);
  }
  const closedJob = await getJob(approvedSession, jobId);
  const verifiedAtBefore = closedJob?.verifiedAt;
  const verifiedByBefore = closedJob?.verifiedByMemberId;
  check("9b closed job snapshot has verifiedAt/verifiedByMemberId set",
    Boolean(verifiedAtBefore) && verifiedByBefore === approvedId);

  const created = await api(approvedSession, "/api/quotes", {
    action: "create", workOrderId: jobId,
    quotedAmount: 500, poNumber: "PO-TEST-1", glCode: "GL-TEST",
  });
  quoteId = created.json.quoteId;
  check("9c quote created via POST /api/quotes", created.status === 200 && Boolean(quoteId));
  const listed = await api(approvedSession, `/api/quotes?workOrderId=${jobId}`);
  const quote = (listed.json.quotes || []).find((entry) => entry.id === quoteId);
  check("9d GET /api/quotes?workOrderId= returns the quote with its amounts",
    quote?.quotedAmount === 500 && quote?.poNumber === "PO-TEST-1" && quote?.glCode === "GL-TEST",
    `quotedAmount=${quote?.quotedAmount} poNumber=${quote?.poNumber} glCode=${quote?.glCode}`);

  const updated = await api(approvedSession, "/api/quotes", {
    action: "update", id: quoteId, actualCost: 475,
  });
  check("9e quote actualCost update is 200", updated.status === 200);
  const jobAfter = await getJob(approvedSession, jobId);
  check("9f updating actualCost does NOT change the job's verified_* fields",
    jobAfter?.status === "completed"
      && jobAfter?.verifiedAt === verifiedAtBefore
      && jobAfter?.verifiedByMemberId === verifiedByBefore,
    `verifiedAt before=${verifiedAtBefore} after=${jobAfter?.verifiedAt}`);
}

// Check 10: a work-order photo uploads, lists back with a signed URL,
// and the gallery stays closed to pending accounts.
{
  // 1x1 transparent PNG.
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  const form = new FormData();
  form.append("workOrderId", String(jobId));
  form.append("phase", "before");
  form.append("description", "E2E Centro 1x1 test photo");
  form.append("file", new Blob([Buffer.from(pngBase64, "base64")], { type: "image/png" }), "e2e-1x1.png");
  const uploaded = await apiMultipart(approvedSession, "/api/photos", form);
  check("10a POST /api/photos multipart (tiny PNG) is 200",
    uploaded.status === 200 && Boolean(uploaded.json.attachmentId),
    `status=${uploaded.status}`);
  const listed = await api(approvedSession, `/api/photos?workOrderId=${jobId}`);
  const photos = listed.json.photos || listed.json.items || [];
  const photo = photos.find((entry) => entry.id === uploaded.json.attachmentId) || photos[0];
  check("10b GET /api/photos?workOrderId= lists the photo with a signedUrl",
    listed.status === 200 && Boolean(photo?.signedUrl),
    `count=${photos.length} signedUrl=${photo?.signedUrl ? "present" : "missing"}`);
  const pendingPhotos = await api(pendingSession, "/api/photos");
  check("10c pending GET /api/photos is 403", pendingPhotos.status === 403);
}

// Check 11: report exports — JSON envelope with the property time
// zone and no attachments, and the default CSV.
{
  const jsonExport = await api(approvedSession, "/api/reports/export?module=jobs&format=json");
  check("11a GET /api/reports/export?module=jobs&format=json is 200", jsonExport.status === 200);
  check("11b JSON envelope has timeZone America/New_York, attachmentsIncluded false, rows array",
    jsonExport.json.timeZone === "America/New_York"
      && jsonExport.json.attachmentsIncluded === false
      && Array.isArray(jsonExport.json.rows),
    `timeZone=${jsonExport.json.timeZone} attachmentsIncluded=${jsonExport.json.attachmentsIncluded}`);
  const csvExport = await apiRaw(approvedSession, "/api/reports/export?module=jobs");
  check("11c CSV export (no format) is 200 text/csv",
    csvExport.status === 200 && csvExport.contentType.includes("text/csv"),
    `status=${csvExport.status} contentType=${csvExport.contentType}`);
}

// Check 12: Centro KPIs count blocked (on-hold) jobs. A dedicated hold
// job is created here so the assertion holds regardless of the state
// the earlier checks left the main job in.
{
  const created = await dashboard(approvedSession, {
    action: "create_job",
    title: `E2E Centro KPI hold ${stamp}`,
    description: "Dedicated hold job for the blocked KPI — E2E staging only",
    recordType: "work_order",
    building: "3000",
    unit: "301",
    origin: "preventive",
  });
  const holdJobId = created.json.job?.id;
  const held = await dashboard(approvedSession, {
    action: "update_job", id: holdJobId, status: "waiting_parts",
    holdReason: "Filter set on order — E2E KPI",
    holdFollowUpDate: futureDate(3),
    holdFollowUpBy: approvedId,
    nextAction: "Confirm the filter delivery date",
  });
  check("12a dedicated hold job placed on hold", held.status === 200);
  const centro = await api(approvedSession, "/api/centro");
  check("12b GET /api/centro is 200 and kpis.blocked >= 1 while a job is on hold",
    centro.status === 200 && centro.json.kpis?.blocked >= 1,
    `blocked=${centro.json.kpis?.blocked}`);
}

// Check 13: guided-note drafts are just drafts — saving arbitrary text
// (even text claiming completion) never completes anything; the
// response carries the facts fingerprint.
{
  const created = await dashboard(approvedSession, {
    action: "create_job",
    title: `E2E Centro notes ${stamp}`,
    description: "Job for the notes rule — E2E staging only",
    recordType: "work_order",
    building: "2000",
    unit: "210",
    origin: "resident",
  });
  const notesJobId = created.json.job?.id;
  const statusAtCreation = created.json.job?.status;
  check("13a notes job created", created.status === 200 && Boolean(notesJobId));
  const saved = await dashboard(approvedSession, {
    action: "save_note_drafts", id: notesJobId,
    maintenanceComment: "E2E arbitrary draft text — Work order completed. (wording only, not a closing)",
    residentNote: "E2E arbitrary resident draft text",
  });
  check("13b save_note_drafts is 200 and notesFingerprint starts with nf_",
    saved.status === 200 && typeof saved.json.notesFingerprint === "string"
      && saved.json.notesFingerprint.startsWith("nf_"),
    `notesFingerprint=${saved.json.notesFingerprint}`);
  const job = await getJob(approvedSession, notesJobId);
  check("13c the app never auto-completed anything: job status remains as created",
    job?.status === statusAtCreation && job?.status !== "completed",
    `created=${statusAtCreation} now=${job?.status}`);
}

console.log(failures === 0 ? "\nALL E2E CENTRO CHECKS PASSED" : `\n${failures} E2E CENTRO CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
