import { makeTranslator } from "@/i18n/translate";

import { attendMessage, attendOutcome, attendanceState, attendanceText } from "./attendance";

const t = makeTranslator("en");

const START = Date.parse("2026-10-20T15:00:00Z");
const END = Date.parse("2026-10-20T16:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const member = { status: "scheduled", starts_at: "2026-10-20T15:00:00Z", ends_at: "2026-10-20T16:00:00Z", rsvp_counts: null };
const staff = { ...member, rsvp_counts: {} };

test("check-in opens 15 minutes before the start, and not a moment earlier", () => {
  expect(attendanceState(member, START - 15 * MINUTE - 1)).toBe("hidden");
  expect(attendanceState(member, START - 15 * MINUTE)).toBe("open");
  expect(attendanceState(member, START)).toBe("open");
  expect(attendanceState(member, END)).toBe("open");
});

test("a member can still answer 24 hours after the end, and after that only sees the answer", () => {
  expect(attendanceState(member, END + 24 * HOUR)).toBe("open");
  expect(attendanceState(member, END + 24 * HOUR + 1)).toBe("closed");
});

test("coaches and owners are never closed out", () => {
  expect(attendanceState(staff, END + 24 * HOUR + 1)).toBe("open");
  expect(attendanceState(staff, END + 400 * 24 * HOUR)).toBe("open");
  expect(attendanceState(staff, START - 16 * MINUTE)).toBe("hidden"); // the opening time is the same
});

test("a cancelled class offers nothing, at any time", () => {
  const cancelled = { ...member, status: "cancelled" };

  expect(attendanceState(cancelled, START)).toBe("hidden");
  expect(attendanceState(cancelled, END + 25 * HOUR)).toBe("hidden");
  expect(attendanceState({ ...staff, status: "cancelled" }, START)).toBe("hidden");
});

test("the recorded answer reads as a sentence, and nothing when none is recorded", () => {
  expect(attendanceText(t, true)).toBe("You attended this class.");
  expect(attendanceText(t, false)).toBe("You didn't attend this class.");
  expect(attendanceText(t, null)).toBeNull();
});

test("each refusal of the server has its own outcome and message", () => {
  expect(attendOutcome(409, "checkin_not_open")).toBe("notOpen");
  expect(attendOutcome(409, "checkin_closed")).toBe("closed");
  expect(attendOutcome(409, "session_cancelled")).toBe("cancelled");
  expect(attendOutcome(409, "no_participant")).toBe("error");
  expect(attendOutcome(404, "session_not_found")).toBe("error");
  expect(attendOutcome(500, undefined)).toBe("error");

  expect(attendMessage(t, "ok")).toBeNull();
  const outcomes = ["notOpen", "closed", "cancelled", "unreachable", "error"] as const;
  const messages = outcomes.map((o) => attendMessage(t, o));
  expect(new Set(messages).size).toBe(outcomes.length);
});
