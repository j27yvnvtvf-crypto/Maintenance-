/**
 * Pure authorization rules for the document library (Phase 1).
 *
 * Like lib/access-rules.ts, this module is intentionally free of imports and
 * side effects so the exact decisions the server makes can be exercised by
 * the verification suite (scripts/verify-library.mjs) without a database.
 * The approval/admin primitives intentionally mirror lib/access-rules.ts
 * (isApprovedAccess / isAdminAccess); the library suite asserts both modules
 * agree on every account state so they cannot silently drift apart.
 *
 * Model summary (extends access model v2, it never replaces it):
 * - An account is OPERATIONAL when approval_status = 'approved' AND
 *   active = true. Pending / rejected / suspended / revoked accounts get
 *   nothing: no list, no detail, no download, no read confirmation (403).
 * - A PUBLISHED (vigente) document is visible to every operational account.
 * - DRAFT and ARCHIVED documents are visible only to the administrator.
 * - Only the administrator (is_admin) may create, edit, publish, archive or
 *   add a version to a document. `job_title` and the legacy `role` are never
 *   inputs here: they grant nothing.
 * - Any operational account may confirm reading a version of a PUBLISHED
 *   document. Read confirmations are evidence of reading, recorded per
 *   version — they are never treated as verification of compliance.
 */

export type LibraryApprovalStatus =
  | "unregistered"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "revoked";

export type LibraryAccessFields = {
  approval_status: LibraryApprovalStatus;
  active: boolean;
  is_admin: boolean;
};

export type DocumentStatus = "draft" | "published" | "archived";

export type DocumentCategory =
  | "sop_greystar"
  | "procedimiento_interno"
  | "manual_fabricante"
  | "sds"
  | "emergencia"
  | "formulario"
  | "otro";

export type DocumentType = "official" | "internal_guide" | "draft";

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "sop_greystar",
  "procedimiento_interno",
  "manual_fabricante",
  "sds",
  "emergencia",
  "formulario",
  "otro",
];

export const DOCUMENT_TYPES: DocumentType[] = ["official", "internal_guide", "draft"];

export const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "published", "archived"];

/** Mirror of isApprovedAccess in lib/access-rules.ts. Keep in sync. */
export function isOperationalAccess(member: LibraryAccessFields): boolean {
  return member.active === true && member.approval_status === "approved";
}

/** Mirror of isAdminAccess in lib/access-rules.ts. Keep in sync. */
export function isLibraryAdmin(member: LibraryAccessFields): boolean {
  return isOperationalAccess(member) && member.is_admin === true;
}

/**
 * Whether the account may see a document at all (list, detail, versions).
 * Published documents are visible to every operational account; draft and
 * archived documents are administrator-only.
 */
export function canViewDocument(
  member: LibraryAccessFields,
  doc: { status: DocumentStatus },
): boolean {
  if (!isOperationalAccess(member)) return false;
  if (doc.status === "published") return true;
  return isLibraryAdmin(member);
}

/**
 * Whether the account may download a version's file. Same rule as viewing:
 * the file bytes of a draft or archived document never leave the private
 * bucket for a non-administrator.
 */
export function canDownloadVersion(
  member: LibraryAccessFields,
  doc: { status: DocumentStatus },
): boolean {
  return canViewDocument(member, doc);
}

/**
 * Only the administrator manages the library: create, edit metadata,
 * publish, archive and add versions. Operational accounts can never do any
 * of these, whatever their job title says.
 */
export function canManageDocuments(member: LibraryAccessFields): boolean {
  return isLibraryAdmin(member);
}

/**
 * Read confirmations exist for the CURRENT published procedure: any
 * operational account may confirm reading a version while its document is
 * published. Confirming a draft or archived document is administrator-only
 * (and normally unnecessary).
 */
export function canConfirmRead(
  member: LibraryAccessFields,
  doc: { status: DocumentStatus },
): boolean {
  if (!isOperationalAccess(member)) return false;
  if (doc.status === "published") return true;
  return isLibraryAdmin(member);
}

/**
 * Whether the account may see WHO read a version (and who has not). Reading
 * evidence about other people is administrative data.
 */
export function canViewReadEvidence(member: LibraryAccessFields): boolean {
  return isLibraryAdmin(member);
}
