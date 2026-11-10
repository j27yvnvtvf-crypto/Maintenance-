/**
 * Pure rules for the guided Maintenance Comment / Resident Note
 * generator (Phase 5 — Centro de Operaciones, spec §11).
 *
 * This is TEMPLATE-BASED guided writing (redacción guiada por
 * plantillas), honestly labelled as such: the text is composed ONLY
 * from the job's recorded fields and the operator's picks from the
 * fixed option lists below — Spanish picker labels in the UI, fixed
 * professional English sentence fragments in the output. No AI is
 * involved and none is simulated; the existing /api/ai endpoint is
 * not used for these notes. Nothing is ever sent automatically: the
 * generators only produce draft text the operator reviews and saves.
 *
 * HARD GUARDS (the reason this module exists):
 * - A completion claim — the phrase "Work order completed" or any
 *   equivalent wording — may appear ONLY when the job carries a valid
 *   recorded verification (verification_confirmed === true AND
 *   verified_at set). If the work is not verified, the generated text
 *   contains no completion claim at all.
 * - When the job is in a hold status, the maintenance comment MUST
 *   end with "Placed on hold pending ..." naming what it waits on,
 *   taken from the recorded fields (vendor, parts, resident
 *   coordination, hold reason).
 * - The resident note is short, plain and courteous, and states
 *   honestly what is done and what is still pending.
 *
 * notesFingerprint(job) hashes exactly the recorded fields that feed
 * these notes, so a saved draft can be flagged as stale when the
 * facts or the status change after the draft was generated.
 */

export type NoteOption = { key: string; es: string; en: string };

/** What the operator picks in the guided form: option keys per group. */
export type NotePicks = {
  findings?: string[];
  actions?: string[];
  tests?: string[];
};

/** The recorded job fields the notes are composed from (camelCase
 * client shape, mirroring lib/jobs-rules.ts Job). */
export type NoteJob = {
  title?: string | null;
  building?: string | null;
  unit?: string | null;
  area?: string | null;
  status?: string | null;
  findings?: string | null;
  cause?: string | null;
  actionPerformed?: string | null;
  nextAction?: string | null;
  holdReason?: string | null;
  holdFollowUpDate?: string | null;
  vendorName?: string | null;
  verificationAction?: string | null;
  verificationTest?: string | null;
  verificationResult?: string | null;
  verificationConfirmed?: boolean | null;
  verifiedAt?: string | null;
};

/** Mirror of HOLD_STATUSES in lib/jobs-rules.ts. Keep in sync. */
const NOTE_HOLD_STATUSES: string[] = [
  "waiting_vendor",
  "waiting_parts",
  "waiting_resident",
  "on_hold",
];

function isHoldStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && NOTE_HOLD_STATUSES.includes(status);
}

/** Findings: Spanish picker label → English sentence fragment. */
export const NOTE_FINDING_OPTIONS: NoteOption[] = [
  { key: "ac_not_cooling", es: "El aire acondicionado no enfría", en: "The air conditioning system was not cooling properly." },
  { key: "hvac_noise", es: "Ruido anormal en el equipo de HVAC", en: "Abnormal noise was coming from the HVAC equipment." },
  { key: "water_leak", es: "Se encontró una fuga de agua", en: "A water leak was found at the affected fixture." },
  { key: "water_damage", es: "Daño por agua visible", en: "Visible water damage was observed at the affected area." },
  { key: "clogged_drain", es: "Desagüe obstruido", en: "The drain was found clogged and draining slowly." },
  { key: "no_power", es: "Sin electricidad en el área afectada", en: "Loss of electrical power was confirmed at the affected area." },
  { key: "appliance_malfunction", es: "Electrodoméstico con falla", en: "The appliance was malfunctioning and not operating correctly." },
  { key: "door_lock_issue", es: "Problema con puerta o cerradura", en: "The door/lock was not operating correctly." },
  { key: "cosmetic_damage", es: "Daño cosmético / pintura", en: "Cosmetic damage was observed on the affected surface." },
  { key: "issue_not_duplicated", es: "No se pudo reproducir el problema reportado", en: "The reported issue could not be duplicated at the time of the visit." },
];

/** Actions performed: Spanish picker label → English sentence fragment. */
export const NOTE_ACTION_OPTIONS: NoteOption[] = [
  { key: "replaced_part", es: "Se reemplazó la pieza dañada", en: "The damaged part was replaced." },
  { key: "repaired", es: "Se realizó la reparación", en: "The repair was performed on the affected component." },
  { key: "unclogged", es: "Se destapó el desagüe", en: "The drain was cleared." },
  { key: "adjusted", es: "Se ajustó y calibró el equipo", en: "The unit was adjusted and calibrated." },
  { key: "reset_equipment", es: "Se reinició el equipo", en: "The equipment was reset and returned to normal settings." },
  { key: "tightened_connections", es: "Se apretaron las conexiones", en: "The connections were tightened and secured." },
  { key: "cleaned", es: "Se limpió el área / equipo", en: "The affected area and equipment were cleaned." },
  { key: "temporary_fix", es: "Se aplicó una solución temporal", en: "A temporary fix was applied pending the permanent repair." },
];

/** Verification tests: Spanish picker label → English sentence fragment. */
export const NOTE_TEST_OPTIONS: NoteOption[] = [
  { key: "operational_test", es: "Se probó el funcionamiento", en: "The system was run and its operation was tested." },
  { key: "leak_check", es: "Se verificó que no haya fugas", en: "The work was checked for leaks under normal operating pressure." },
  { key: "temperature_check", es: "Se midió la temperatura", en: "Temperature readings were taken and confirmed within the normal range." },
  { key: "cycle_test", es: "Se corrió un ciclo completo", en: "A full operating cycle was run and observed." },
  { key: "visual_inspection", es: "Inspección visual final", en: "A final visual inspection of the work area was performed." },
];

/** Aliases matching the Phase 5 contract wording. */
export const NOTE_FINDINGS = NOTE_FINDING_OPTIONS;
export const NOTE_ACTIONS = NOTE_ACTION_OPTIONS;
export const NOTE_TESTS = NOTE_TEST_OPTIONS;

/**
 * A job's verification is valid only when BOTH facts are recorded:
 * the explicit confirmation flag and the server-written verified_at
 * timestamp. One without the other is not verification.
 */
export function hasValidVerification(job: NoteJob): boolean {
  return job.verificationConfirmed === true && typeof job.verifiedAt === "string" && job.verifiedAt.length > 0;
}

function fragments(options: NoteOption[], keys: string[] | undefined): string[] {
  if (!keys) return [];
  const byKey = new Map(options.map((option) => [option.key, option.en]));
  return keys.map((key) => byKey.get(key)).filter((text): text is string => typeof text === "string");
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function locationSentence(job: NoteJob): string | null {
  const parts: string[] = [];
  if (job.building) parts.push(`Building ${job.building}`);
  if (job.unit) parts.push(`Unit ${job.unit}`);
  if (parts.length === 0 && job.area) parts.push(job.area);
  return parts.length > 0 ? `Location: ${parts.join(", ")}.` : null;
}

/** What a hold waits on, in English, from the recorded fields only. */
function holdPendingText(job: NoteJob): string {
  const reason = job.holdReason?.trim();
  switch (job.status) {
    case "waiting_vendor":
      return job.vendorName?.trim()
        ? `the scheduled vendor visit (${job.vendorName.trim()})${reason ? ` — ${reason}` : ""}`
        : `the scheduled vendor visit${reason ? ` — ${reason}` : ""}`;
    case "waiting_parts":
      return `the arrival of the required parts${reason ? ` — ${reason}` : ""}`;
    case "waiting_resident":
      return `coordination with the resident to schedule access${reason ? ` — ${reason}` : ""}`;
    default:
      return reason || "the next scheduled step";
  }
}

/**
 * The 🔧 Maintenance Comment: a professional English record composed
 * only from the job's recorded fields and the operator's picks.
 * - With valid verification it opens "Work order completed." — the
 *   ONLY case in which any completion claim appears.
 * - Without verification it reports the work performed and states the
 *   work order remains open.
 * - In a hold status it ends with "Placed on hold pending ...".
 */
export function buildMaintenanceComment(job: NoteJob, picks: NotePicks = {}): string {
  const verified = hasValidVerification(job);
  const onHold = isHoldStatus(job.status);
  const sentences: string[] = [];

  sentences.push(verified ? "Work order completed." : "Maintenance visit performed.");

  const location = locationSentence(job);
  if (location) sentences.push(location);

  for (const fragment of fragments(NOTE_FINDING_OPTIONS, picks.findings)) sentences.push(fragment);
  if (job.findings?.trim()) sentences.push(`Findings: ${asSentence(job.findings)}`);
  if (job.cause?.trim()) sentences.push(`Cause identified: ${asSentence(job.cause)}`);

  for (const fragment of fragments(NOTE_ACTION_OPTIONS, picks.actions)) sentences.push(fragment);
  if (job.actionPerformed?.trim()) sentences.push(`Work performed: ${asSentence(job.actionPerformed)}`);
  if (job.verificationAction?.trim()) sentences.push(`Final action: ${asSentence(job.verificationAction)}`);

  for (const fragment of fragments(NOTE_TEST_OPTIONS, picks.tests)) sentences.push(fragment);
  if (job.verificationTest?.trim()) sentences.push(`Verification test: ${asSentence(job.verificationTest)}`);
  if (job.verificationResult?.trim()) sentences.push(`Verification result: ${asSentence(job.verificationResult)}`);

  if (verified) {
    sentences.push("The work was verified on site after completion.");
  } else if (!onHold) {
    sentences.push("The work order remains open pending completion and verification.");
    if (job.nextAction?.trim()) sentences.push(`Next action: ${asSentence(job.nextAction)}`);
  }

  if (onHold) {
    if (job.nextAction?.trim()) sentences.push(`Next action: ${asSentence(job.nextAction)}`);
    sentences.push(`Placed on hold pending ${holdPendingText(job)}.`);
  }

  return sentences.join(" ");
}

/**
 * The 🏠 Resident Note: short, plain, courteous English for the
 * resident. It claims completion ONLY with valid verification; on
 * hold or still-open work it says plainly that the work is not
 * finished yet and what is being waited on.
 */
export function buildResidentNote(job: NoteJob, picks: NotePicks = {}): string {
  void picks; // Resident wording comes from the recorded job state, not picks.
  const verified = hasValidVerification(job);
  const sentences: string[] = ["Hello, this is the maintenance team at The Darley."];

  if (verified) {
    sentences.push("The requested work in your home has been completed and verified.");
    sentences.push("Thank you for your patience. Please let us know if anything else comes up.");
    return sentences.join(" ");
  }

  if (isHoldStatus(job.status)) {
    sentences.push("We worked on the reported issue, but the work is not finished yet.");
    sentences.push(`We are currently waiting for ${holdPendingText(job)}.`);
    if (job.nextAction?.trim()) sentences.push(`Next step: ${asSentence(job.nextAction)}`);
    sentences.push("We will update you as soon as there is progress. Thank you for your patience.");
    return sentences.join(" ");
  }

  sentences.push("We have started working on the reported issue, but the work is not finished yet.");
  if (job.nextAction?.trim()) sentences.push(`Next step: ${asSentence(job.nextAction)}`);
  sentences.push("We will update you as soon as there is progress. Thank you for your patience.");
  return sentences.join(" ");
}

/**
 * Stable fingerprint of exactly the recorded fields that feed the
 * notes (status, findings, cause, action performed, verification
 * fields, hold fields, next action). When it differs from the
 * fingerprint stored with a saved draft, the draft is stale.
 * FNV-1a 32-bit over a fixed-order JSON encoding — deterministic
 * across runs and platforms.
 */
export function notesFingerprint(job: NoteJob): string {
  const fields = [
    job.status ?? null,
    job.findings ?? null,
    job.cause ?? null,
    job.actionPerformed ?? null,
    job.verificationAction ?? null,
    job.verificationTest ?? null,
    job.verificationResult ?? null,
    job.verificationConfirmed === true,
    job.verifiedAt ?? null,
    job.holdReason ?? null,
    job.holdFollowUpDate ?? null,
    job.nextAction ?? null,
  ];
  const text = JSON.stringify(fields);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `nf_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
