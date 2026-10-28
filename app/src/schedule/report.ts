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

export type ReportForm = Record<FieldKey, string>;

export const EMPTY_FORM: ReportForm = { summary: "", went_well: "", needs_work: "", observations: "" };

/** The form for a report the server sent (a field left blank comes as null); no report: an empty form. */
export function formFromReport(report: Partial<Record<FieldKey, string | null>> | null): ReportForm {
  return {
    summary: report?.summary ?? "",
    went_well: report?.went_well ?? "",
    needs_work: report?.needs_work ?? "",
    observations: report?.observations ?? "",
  };
}

/**
 * The body of `PUT /sessions/{id}/report`. The PUT replaces the whole report, so all four fields
 * are always sent and a blank one is null: it clears what was stored. `notes` is left out on
 * purpose, which tells the server to keep the session's notes as they are.
 */
export function toPayload(form: ReportForm): Record<FieldKey, string | null> {
  const field = (key: FieldKey) => form[key].trim() || null;
  return {
    summary: field("summary"),
    went_well: field("went_well"),
    needs_work: field("needs_work"),
    observations: field("observations"),
  };
}

/** The server refuses a report with no text (`empty_report`), so the form does not offer it. */
export function canSave(form: ReportForm): boolean {
  return FIELDS.some(({ key }) => form[key].trim() !== "");
}

/** Whether anything differs from what was last loaded or saved. */
export function isDirty(form: ReportForm, saved: ReportForm): boolean {
  return FIELDS.some(({ key }) => form[key] !== saved[key]);
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
