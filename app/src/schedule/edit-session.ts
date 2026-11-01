// The rules of the "Edit class" form, kept apart from the screen so they can be tested. The form is the
// "New class" one plus the preview text; only what the person changed is sent.
import type { Translator } from "@/i18n/translate";

import { DURATIONS, dayChoices, seatsValue, times, type NewSessionForm } from "./new-session";
import { localTime, startOfDay } from "./time";
import type { SessionDetail } from "./use-session";

export type EditForm = NewSessionForm & { preview: string };

/** The form as the class stands now, read back in the studio's timezone. */
export function editForm(session: SessionDetail, timeZone: string): EditForm {
  const start = Date.parse(session.starts_at);
  const { hour, minute } = localTime(start, timeZone);
  return {
    classTypeId: session.class_type_id,
    dayStart: startOfDay(start, timeZone),
    hour,
    minute,
    duration: Math.round((Date.parse(session.ends_at) - start) / 60_000),
    seats: session.capacity === null ? "" : String(session.capacity),
    coachId: session.coach_id,
    preview: session.preview ?? "",
  };
}

/** The usual choices, plus the class's own value when it is not one of them (a past day, 75 minutes). */
const withCurrent = (usual: number[], current: number): number[] =>
  usual.includes(current) ? usual : [...usual, current].sort((a, b) => a - b);

export const editDays = (now: number, timeZone: string, current: number) => withCurrent(dayChoices(now, timeZone), current);
export const editDurations = (current: number) => withCurrent(DURATIONS, current);

export type SessionChanges = {
  starts_at?: string;
  ends_at?: string;
  capacity?: number | null;
  coach_id?: string;
  preview?: string | null;
};

/** The body of `PATCH /sessions/{id}`: only the fields that differ from the class. Empty = nothing to save. */
export function toPatch(form: EditForm, session: SessionDetail, timeZone: string, seatsShown: boolean): SessionChanges {
  const { start, end } = times(form, timeZone);
  const patch: SessionChanges = {};
  if (start !== Date.parse(session.starts_at)) patch.starts_at = new Date(start).toISOString();
  if (end !== Date.parse(session.ends_at)) patch.ends_at = new Date(end).toISOString();
  const seats = seatsShown ? seatsValue(form.seats) : session.capacity;
  if (seats !== "invalid" && seats !== session.capacity) patch.capacity = seats;
  if (form.coachId && form.coachId !== session.coach_id) patch.coach_id = form.coachId;
  const preview = form.preview.trim();
  if (preview !== (session.preview ?? "")) patch.preview = preview === "" ? null : preview;
  return patch;
}

/** How many things the person changed, for "Save 2 changes": day and time count apart, as the form shows them apart. */
export function changeCount(form: EditForm, session: SessionDetail, timeZone: string, seatsShown: boolean): number {
  const was = editForm(session, timeZone);
  const patch = toPatch(form, session, timeZone, seatsShown);
  return [
    form.dayStart !== was.dayStart,
    form.hour !== was.hour || form.minute !== was.minute,
    form.duration !== was.duration,
    "capacity" in patch,
    "coach_id" in patch,
    "preview" in patch,
  ].filter(Boolean).length;
}

export type ChangeOutcome = "ok" | "notYours" | "cancelled" | "badTimes" | "badCoach" | "hasHistory" | "unreachable" | "error";

export function changeOutcome(status: number, detail: unknown): ChangeOutcome {
  if (status === 403 && detail === "not_your_session") return "notYours";
  if (status === 409 && detail === "session_cancelled") return "cancelled";
  if (status === 409 && detail === "session_has_history") return "hasHistory";
  if (status === 422 && detail === "invalid_times") return "badTimes";
  if (status === 422 && detail === "invalid_coach") return "badCoach";
  return "error";
}

/** The message under the Save or Cancel button after a try; null when it worked. */
export function changeMessage(t: Translator, outcome: ChangeOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "notYours":
      return t("editSession.notYours");
    case "cancelled":
      return t("editSession.cancelled");
    case "badTimes":
      return t("editSession.badTimes");
    case "badCoach":
      return t("editSession.badCoach");
    case "hasHistory":
      return t("session.hasHistory");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}

/** Owners change any class, a coach their own; a cancelled class is final. The API has the last word. */
export const canChange = (session: SessionDetail, role: string, userId: string | undefined): boolean =>
  session.status !== "cancelled" && (role === "owner" || (role === "coach" && session.coach_id === userId));
