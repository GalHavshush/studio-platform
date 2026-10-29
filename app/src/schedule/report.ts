// The rules of the class report form, kept apart from the screen so they can be tested.
// Every function that words something takes the translator `t` first.
import type { Key } from "@/i18n/en";
import type { Translator } from "@/i18n/translate";

export type FieldKey = "summary" | "went_well" | "needs_work" | "observations";

// In the order they appear on the form. The server allows 5000 characters in each.
export const FIELDS: { key: FieldKey; label: Key }[] = [
  { key: "summary", label: "report.summary" },
  { key: "went_well", label: "report.wentWell" },
  { key: "needs_work", label: "report.needsWork" },
  { key: "observations", label: "report.observations" },
];
export const MAX_LENGTH = 5000;

/** One person's note and whether the member it is about may read it. Private until shared. */
export type NoteDraft = { body: string; shared: boolean };
const NO_NOTE: NoteDraft = { body: "", shared: false };

/** Someone who came to the class, as `GET /sessions/{id}/attendees` names them. */
export type Attendee = { participant_id: string; name: string };

type ServerNote = { participant_id: string; body: string; shared_with_member: boolean };

// `notes` holds EVERY note of the session, by participant id, not only the ones the screen shows a
// row for: the PUT replaces all of the session's notes, so a note of someone who is not listed
// (say, un-marked after the note was written) has to travel back untouched or it would be deleted.
export type ReportForm = Record<FieldKey, string> & { notes: Record<string, NoteDraft> };

export const EMPTY_FORM: ReportForm = {
  summary: "",
  went_well: "",
  needs_work: "",
  observations: "",
  notes: {},
};

/** The form for a report the server sent (a field left blank comes as null); no report: an empty form. */
export function formFromReport(
  report: (Partial<Record<FieldKey, string | null>> & { notes?: ServerNote[] }) | null,
): ReportForm {
  return {
    summary: report?.summary ?? "",
    went_well: report?.went_well ?? "",
    needs_work: report?.needs_work ?? "",
    observations: report?.observations ?? "",
    notes: Object.fromEntries(
      (report?.notes ?? []).map((n) => [n.participant_id, { body: n.body, shared: n.shared_with_member }]),
    ),
  };
}

/** A person's note as the form has it: none yet is an empty, unshared note. */
export function noteFor(form: ReportForm, participantId: string): NoteDraft {
  return form.notes[participantId] ?? NO_NOTE;
}

/** The form with one person's note changed; nothing else moves. */
export function withNote(form: ReportForm, participantId: string, change: Partial<NoteDraft>): ReportForm {
  return { ...form, notes: { ...form.notes, [participantId]: { ...noteFor(form, participantId), ...change } } };
}

const hasText = (note: NoteDraft) => note.body.trim() !== "";

/**
 * The body of `PUT /sessions/{id}/report`. The PUT replaces the whole report, so all four fields
 * are always sent and a blank one is null: it clears what was stored. `notes` is a list that
 * replaces ALL of the session's notes: a blank note is left out (which deletes it), the sharing
 * flag is always a real boolean, and notes of people with no row on screen are sent as they were.
 */
export function toPayload(form: ReportForm) {
  const field = (key: FieldKey) => form[key].trim() || null;
  return {
    summary: field("summary"),
    went_well: field("went_well"),
    needs_work: field("needs_work"),
    observations: field("observations"),
    notes: Object.entries(form.notes)
      .filter(([, note]) => hasText(note))
      .map(([participant_id, note]) => ({
        participant_id,
        body: note.body.trim(),
        shared_with_member: note.shared,
      })),
  };
}

/** The server refuses a report with no text and no note (`empty_report`), so the form does not offer it. */
export function canSave(form: ReportForm): boolean {
  return FIELDS.some(({ key }) => form[key].trim() !== "") || Object.values(form.notes).some(hasText);
}

/** Whether anything differs from what was last loaded or saved. A note with no text is no note. */
export function isDirty(form: ReportForm, saved: ReportForm): boolean {
  if (FIELDS.some(({ key }) => form[key] !== saved[key])) return true;
  const effective = (notes: ReportForm["notes"], id: string) => (hasText(notes[id] ?? NO_NOTE) ? notes[id] : NO_NOTE);
  return [...new Set([...Object.keys(form.notes), ...Object.keys(saved.notes)])].some((id) => {
    const a = effective(form.notes, id);
    const b = effective(saved.notes, id);
    return a.body !== b.body || a.shared !== b.shared;
  });
}

/**
 * Whether to offer the report: coaches and owners (the only ones the session carries counts for),
 * once the class has started, and not when it was cancelled. The server decides the rest (a coach
 * can only write the reports of their own classes).
 */
export function canWriteReport(
  session: { rsvp_counts: unknown; status: string; starts_at: string },
  now: number,
): boolean {
  return session.rsvp_counts !== null && session.status !== "cancelled" && Date.parse(session.starts_at) <= now;
}

export type SaveOutcome =
  | "ok"
  | "empty"
  | "notStarted"
  | "cancelled"
  | "notYours"
  | "unreachable"
  | "error";

/** What a refused save is called, from the status and the `detail` code of the error body. */
export function saveOutcome(status: number, detail: unknown): SaveOutcome {
  if (status === 422 && detail === "empty_report") return "empty";
  if (status === 409 && detail === "session_not_started") return "notStarted";
  if (status === 409 && detail === "session_cancelled") return "cancelled";
  if (status === 403 && detail === "not_your_session") return "notYours";
  return "error";
}

/** The message under the Save button after a try; null when it worked. */
export function saveMessage(t: Translator, outcome: SaveOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "empty":
      return t("report.needText");
    case "notStarted":
      return t("report.notStarted");
    case "cancelled":
      return t("session.cancelled");
    case "notYours":
      return t("report.notYours");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
