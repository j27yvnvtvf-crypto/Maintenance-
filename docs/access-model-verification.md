# Access model v2 — verification matrix

The six mandatory acceptance checks from the Phase 0 specification, and how
each one is verified. Two layers exist:

- **Decision + static contract suite** — `scripts/verify-access-model.mjs`
  (runs anywhere with `pnpm verify:access`). It imports the production rules
  from `lib/access-rules.ts` and scans the shipped source for the structural
  guarantees. These tests RUN and PASS in CI/local.
- **End-to-end suite** — `scripts/e2e-access-model.mjs`. It drives a real
  deployment over HTTP with real accounts. It needs a disposable staging
  Supabase project, which does **not exist yet**, so every end-to-end item
  below is **PENDING — not verified** until that script runs green against
  staging. Nothing in this document claims otherwise.

| # | Mandatory check | Decision/static layer | End-to-end layer |
|---|---|---|---|
| 1 | A pending account cannot consult data or files | ✅ Tested: non-approved states fail `isApprovedAccess`; GET returns an empty bootstrap payload; all data actions gate on approval | ⏳ Pending staging: pending session receives empty bootstrap and 403 on `create_job` (`e2e` checks 1a/1b) |
| 2 | Writing "Admin" as job title grants no privileges | ✅ Tested: job titles are not inputs to the decision functions; approved "Admin"-titled members have `isAdminAccess = false` | ⏳ Pending staging: an approved "Admin"-titled user gets 403 on `suspend_member` (checks 2/2b) |
| 3 | Two approved users with different titles can create and close work orders | ✅ Tested at decision level: operational access is one boolean shared by all approved accounts; route source has no role gates left | ⏳ Pending staging: technician-titled user creates a WO, manager-titled user closes it (checks 3a–3c) |
| 4 | A regular user cannot change configuration, approve accounts, or alter history | ✅ Tested: `canAdminActOn` is false for non-admins; source scan finds no delete path for work orders, members, or the audit log; admin actions write to `admin_audit_log` | ⏳ Pending staging: regular user gets 403 on `reject_member`, 400 on a delete attempt, and the audit log contains the admin's actions (checks 4a–4c) |
| 5 | A suspended account loses access even with an open session | ✅ Tested at decision level: suspended/revoked states fail the per-request gate and cannot self-reactivate (`canRequestAccess = false`) | ⏳ Pending staging: the same live session goes from 200/approved to 403/suspended right after the admin suspends it (checks 5a–5d) |
| 6 | The verified administrator keeps exclusive administrative control | ✅ Tested: only `is_admin = true` + approved + active passes `isAdminAccess`; admins cannot act on themselves; app code and migrations never assign `is_admin` (source scan) | ⏳ Pending staging: exactly one `is_admin` row exists (the bootstrapped account) and self-suspension via API is rejected (checks 6/6b) |

## Identity verification data (follow-up, 3 Nov 2026)

At the owner's request, registration now collects the data needed to verify
that a requester is a real, known person: full name (already required), a
**personal phone number** (new, required, basic 7–15 digit validation) and
the free-text job title. The phone travels in the sign-up metadata — the
same path as the name and job title — and is stored in `members.phone`
(migration `20261103221500_member_phone.sql`, additive) next to the pending
request. Applicants can review and correct their name, phone and job title
from their own access-request screen without touching any other data.

| # | Follow-up check | Decision/static layer | End-to-end layer |
|---|---|---|---|
| 7 | Registration requires a valid personal phone | ✅ Tested: the shared validator (`isValidPhone`/`normalizePhone` in `lib/access-rules.ts`) accepts/rejects the case matrix; source contracts confirm the sign-up form validates and sends the phone in the auth metadata, `getCurrentMember` stores it, the `request_access` endpoint re-validates it server-side, and the column arrives via its own additive migration | ⏳ Pending staging: a sign-up/request without a valid phone cannot produce an approvable request with complete data |
| 8 | The phone never appears in non-admin payloads | ✅ Tested: the source of `memberForClient` (team lists and all shared payloads) never mentions `phone`; the phone-carrying builder `memberForClientWithPhone` is wired in exactly three places — the owner's own `me` object and the administrator-only `pendingTeam` section | ⏳ Pending staging: an approved non-admin's GET response contains no `phone` field anywhere outside their own `me`; the administrator's `pendingTeam` entries show the phone |

Privacy rule, restated: the phone is visible **only** to the administrator
(in access requests / member detail) and to the account owner in their own
request screen. The dashboard UI can only display what the API sends, and
the API sends other members' phones exclusively inside the
administrator-gated `pendingTeam` section.

## Why suspension works against open sessions

Supabase Auth sessions are JWTs; they cannot be selectively recalled for a
single user with the installed `@supabase/auth-js` admin API (its
`admin.signOut` takes a user JWT, not a user id). The model therefore does
not rely on the JWT for authorization at all:

1. Every API route calls `getCurrentMember()`, which re-reads the account's
   `approval_status`/`active` from the database on **every request**.
2. All property data flows through those server routes; the browser only
   holds the publishable key, and RLS denies anon/authenticated direct table
   access (`*_server_only` policies).
3. So the moment `suspend_member` flips the row, the very next request from
   the still-open session returns 403 and the UI falls back to the suspended
   screen. Revocation goes further and deletes the auth account itself
   (`auth.admin.deleteUser`), destroying its sessions and refresh tokens.

## How to run the end-to-end suite

See the header of `scripts/e2e-access-model.mjs`. In short: create a
throwaway Supabase project, apply the migrations, deploy this branch to a
staging URL, bootstrap the staging admin with `docs/admin-bootstrap.sql`,
set the `E2E_*` environment variables, and run
`node scripts/e2e-access-model.mjs`. Never run it against production.
