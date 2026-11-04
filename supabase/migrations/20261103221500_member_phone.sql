-- Identity verification data (follow-up to access model v2, Phase 0).
--
-- members.phone — the personal phone number each person provides when
-- requesting access, so the administrator can verify that the requester is
-- who they claim to be before approving the account.
--
-- Privacy rule (enforced in the server payload builders, lib/access.ts):
-- the phone is personal data with a single legitimate viewer — the
-- administrator, in the access-request / member context. It is NEVER
-- included in team lists, work-order payloads or any other response served
-- to non-administrator accounts. The account owner also sees their own
-- phone in their own access-request screen so they can correct it.
--
-- The number travels with the sign-up metadata (same path as the full name
-- and the job title) and is stored when the member row is created, next to
-- the pending access request. Basic format validation (7 to 15 digits)
-- lives in lib/access-rules.ts and runs on the client and on the server.
--
-- This migration is ADDITIVE ONLY: one nullable column, no existing data
-- is touched. Existing members simply have no phone on file until they
-- provide one.

alter table public.members
  add column if not exists phone text;

comment on column public.members.phone is
  'Personal phone for identity verification of access requests. Visible only to the administrator and to the account owner; never exposed in non-admin API payloads.';
