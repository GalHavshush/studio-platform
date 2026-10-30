// The rules of the "New class" form, kept apart from the screen so they can be tested. Every function
// that words something takes the translator `t` first.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import { addDays, localTime, startOfDay, zonedInstant } from "./time";

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
  };
}

/** `value` moved by `delta` steps on a clock face of `size` values, wrapping round. */
export const wrap = (value: number, delta: number, size: number): number => (((value + delta) % size) + size) % size;

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

/** The body of `POST /sessions`. No coach: the API makes the caller the coach. */
export function toPayload(form: NewSessionForm, timeZone: string, seatsShown: boolean) {
  const { start, end } = times(form, timeZone);
  const seats = seatsShown ? seatsValue(form.seats) : null;
  return {
    class_type_id: form.classTypeId as string,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    ...(typeof seats === "number" ? { capacity: seats } : {}),
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
