// The rules of the "New class" form, kept apart from the screen so they can be tested. Every function
// that words something takes the translator `t` first.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import { addDays, dayKey, localTime, startOfDay, zonedInstant } from "./time";

export type ClassTypeChoice = components["schemas"]["ClassTypeOut"];

export const DURATIONS = [30, 45, 60, 90]; // minutes
export const DAYS_AHEAD = 14;
export const MINUTE_STEP = 5;

export type NewSessionForm = {
  classTypeId: string | null;
  dayStart: number; // the studio's midnight of the chosen day
  hour: number;
  minute: number;
  duration: number; // minutes
  seats: string; // what was typed; empty means unlimited
  coachId: string | null; // an owner's pick; null means the caller
};

/** Today and the days after it, as the studio's midnights, for the day chips. */
export const dayChoices = (now: number, timeZone: string): number[] =>
  Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(startOfDay(now, timeZone), i, timeZone));

/** Today, at the next full hour (the last hour of the day stays at 23:00). */
export function initialForm(now: number, timeZone: string): NewSessionForm {
  const { hour } = localTime(now, timeZone);
  return {
    classTypeId: null,
    dayStart: startOfDay(now, timeZone),
    hour: Math.min(hour + 1, 23),
    minute: 0,
    duration: 60,
    seats: "",
    coachId: null,
  };
}

/** `value` moved by `delta` steps on a clock face of `size` values, wrapping round. */
export const wrap = (value: number, delta: number, size: number): number => (((value + delta) % size) + size) % size;

type PastClass = { class_type_id: string; coach_id: string; starts_at: string; ends_at: string; capacity: number | null; status: string };

/**
 * What to start the form from: the latest class that has started and was not cancelled, preferring
 * the caller's own (an owner who does not teach takes the latest of anyone's). Its class type must
 * still be on offer, or the next one back is used. Null when there is none: the form stays plain.
 */
export function formFromLastClass(
  sessions: PastClass[],
  offeredTypeIds: string[],
  now: number,
  timeZone: string,
  userId: string | undefined,
): Partial<NewSessionForm> | null {
  const past = sessions
    .filter((s) => s.status !== "cancelled" && Date.parse(s.starts_at) <= now && offeredTypeIds.includes(s.class_type_id))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const last = past.find((s) => s.coach_id === userId) ?? past[0];
  if (!last) return null;
  const start = Date.parse(last.starts_at);
  const { hour, minute } = localTime(start, timeZone);
  return {
    classTypeId: last.class_type_id,
    coachId: last.coach_id === userId ? null : last.coach_id,
    hour,
    minute,
    duration: Math.round((Date.parse(last.ends_at) - start) / 60_000),
    seats: last.capacity === null ? "" : String(last.capacity),
  };
}

/** Seats only exist for a booking-mode class in a studio that has the booking module on. */
export const showSeats = (type: ClassTypeChoice | undefined, modules: string[]): boolean =>
  type?.attendance_mode === "booking" && modules.includes("booking");

/** The typed seats: null for none (unlimited), a whole number above zero, or "invalid". */
export function seatsValue(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return /^\d+$/.test(trimmed) && n > 0 ? n : "invalid";
}

export const canCreate = (form: NewSessionForm, seatsShown: boolean): boolean =>
  form.classTypeId !== null && (!seatsShown || seatsValue(form.seats) !== "invalid");

/** The start and end of the class as instants, the end being the start plus the length. */
export function times(form: NewSessionForm, timeZone: string): { start: number; end: number } {
  const start = zonedInstant(form.dayStart, form.hour, form.minute, timeZone);
  return { start, end: start + form.duration * 60_000 };
}

/** The body of `POST /sessions`. Without a coach the API makes the caller the coach. */
export function toPayload(form: NewSessionForm, timeZone: string, seatsShown: boolean) {
  const { start, end } = times(form, timeZone);
  const seats = seatsShown ? seatsValue(form.seats) : null;
  return {
    class_type_id: form.classTypeId as string,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    ...(typeof seats === "number" ? { capacity: seats } : {}),
    ...(form.coachId ? { coach_id: form.coachId } : {}),
  };
}

/**
 * The body of `POST /series`: the chosen day is the first date, and its weekday (0 is Monday) is the
 * weekday, so the two always agree. The time is the studio's wall clock, never converted to an instant.
 */
export function toSeriesPayload(form: NewSessionForm, timeZone: string, seatsShown: boolean) {
  const first_date = dayKey(form.dayStart, timeZone);
  const seats = seatsShown ? seatsValue(form.seats) : null;
  return {
    class_type_id: form.classTypeId as string,
    weekday: (new Date(`${first_date}T00:00:00Z`).getUTCDay() + 6) % 7,
    start_time: `${String(form.hour).padStart(2, "0")}:${String(form.minute).padStart(2, "0")}`,
    duration_minutes: form.duration,
    first_date,
    ...(typeof seats === "number" ? { capacity: seats } : {}),
    ...(form.coachId ? { coach_id: form.coachId } : {}),
  };
}

export type CreateOutcome = "ok" | "typeArchived" | "typeGone" | "notYours" | "unreachable" | "error";

export function createOutcome(status: number, detail: unknown): CreateOutcome {
  if (status === 422 && detail === "class_type_archived") return "typeArchived";
  if (status === 404 && detail === "class_type_not_found") return "typeGone";
  if (status === 403 && detail === "not_your_session") return "notYours";
  return "error";
}

/** The message under the Create button after a try; null when it worked. */
export function createMessage(t: Translator, outcome: CreateOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "typeArchived":
      return t("newSession.typeArchived");
    case "typeGone":
      return t("newSession.typeGone");
    case "notYours":
      return t("newSession.notYours");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
