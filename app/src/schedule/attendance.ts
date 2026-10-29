// The rules of "did you come?", kept apart from the screen so they can be tested. They mirror the
// API's check-in window (`app/attendance.py`); the server stays the judge, this only decides what
// to offer. Every function that words something takes the translator `t` first.
import type { Translator } from "@/i18n/translate";

// Check-in opens this long before the start. Members can answer until CLOSES_AFTER the end;
// coaches and owners have no end.
export const OPENS_BEFORE_MS = 15 * 60 * 1000;
export const CLOSES_AFTER_MS = 24 * 60 * 60 * 1000;

export type AttendanceState = "hidden" | "open" | "closed";

/**
 * What to show: nothing (not open yet, or the class was cancelled), the two buttons, or, once a
 * member's time is up, only the answer. Staff (the session carries counts only for them) are
 * never closed out.
 */
export function attendanceState(
  session: { status: string; starts_at: string; ends_at: string; rsvp_counts: unknown },
  now: number,
): AttendanceState {
  if (session.status === "cancelled") return "hidden";
  if (now < Date.parse(session.starts_at) - OPENS_BEFORE_MS) return "hidden";
  const staff = session.rsvp_counts !== null;
  if (!staff && now > Date.parse(session.ends_at) + CLOSES_AFTER_MS) return "closed";
  return "open";
}

/** The two answers; the button for the recorded one is highlighted, neither when nothing is recorded. */
export const ATTENDANCE_CHOICES: { value: boolean; label: "attendance.yes" | "attendance.no" }[] = [
  { value: true, label: "attendance.yes" },
  { value: false, label: "attendance.no" },
];

/** The recorded answer as a sentence, for when it can no longer be changed; null when none. */
export function attendanceText(t: Translator, myAttended: boolean | null): string | null {
  if (myAttended === null) return null;
  return t(myAttended ? "attendance.youCame" : "attendance.youDidNot");
}

export type AttendOutcome = "ok" | "notOpen" | "closed" | "cancelled" | "notYours" | "unreachable" | "error";

/** What a refused answer is called, from the status and the `detail` code of the error body. */
export function attendOutcome(status: number, detail: unknown): AttendOutcome {
  if (status === 409 && detail === "checkin_not_open") return "notOpen";
  if (status === 409 && detail === "checkin_closed") return "closed";
  if (status === 409 && detail === "session_cancelled") return "cancelled";
  if (status === 403 && detail === "not_your_session") return "notYours"; // a coach marking someone on another coach's class
  return "error";
}

/** The message under the buttons after a try; null when it worked. */
export function attendMessage(t: Translator, outcome: AttendOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "notOpen":
      return t("attendance.notOpen");
    case "closed":
      return t("attendance.closed");
    case "cancelled":
      return t("session.cancelled");
    case "notYours":
      return t("attendance.notYours");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
