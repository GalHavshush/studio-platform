import { makeTranslator } from "@/i18n/translate";

import { canChange, changeMessage, changeOutcome, editDays, editDurations, editForm, toPatch } from "./edit-session";
import { startOfDay } from "./time";
import type { SessionDetail } from "./use-session";

const Z = "Asia/Jerusalem";
const t = makeTranslator("en");

// Thu 22 Oct 2026, 09:30-10:30 in Jerusalem (UTC+3)
const session = {
  id: "s1",
  class_type_id: "c1",
  coach_id: "u1",
  starts_at: "2026-10-22T06:30:00.000Z",
  ends_at: "2026-10-22T07:30:00.000Z",
  status: "scheduled",
  preview: "Bring a mat",
  capacity: 12,
} as SessionDetail;

test("the form starts as the class is, in the studio's clock", () => {
  const form = editForm(session, Z);
  expect(form).toMatchObject({ hour: 9, minute: 30, duration: 60, seats: "12", preview: "Bring a mat" });
  expect(form.dayStart).toBe(startOfDay(Date.parse(session.starts_at), Z));
});

test("an untouched form changes nothing", () => {
  expect(toPatch(editForm(session, Z), session, Z, true)).toEqual({});
});

test("only what differs is sent", () => {
  const form = { ...editForm(session, Z), hour: 10 };
  expect(toPatch(form, session, Z, true)).toEqual({
    starts_at: "2026-10-22T07:30:00.000Z",
    ends_at: "2026-10-22T08:30:00.000Z",
  });
  expect(toPatch({ ...editForm(session, Z), duration: 90 }, session, Z, true)).toEqual({
    ends_at: "2026-10-22T08:00:00.000Z",
  });
});

test("empty seats make the class unlimited, and a preview cleared is null", () => {
  const form = { ...editForm(session, Z), seats: "", preview: "  " };
  expect(toPatch(form, session, Z, true)).toEqual({ capacity: null, preview: null });
});

test("seats are left alone when the form does not show them, or holds an invalid number", () => {
  const form = { ...editForm(session, Z), seats: "0" };
  expect(toPatch(form, session, Z, true)).toEqual({});
  expect(toPatch({ ...form, seats: "" }, session, Z, false)).toEqual({});
});

test("the class's own day and length are offered even outside the usual choices", () => {
  const now = Date.parse("2026-10-30T10:00:00Z");
  const past = startOfDay(Date.parse(session.starts_at), Z);
  expect(editDays(now, Z, past)[0]).toBe(past);
  expect(editDays(now, Z, past)).toHaveLength(15);
  expect(editDurations(75)).toEqual([30, 45, 60, 75, 90]);
  expect(editDurations(60)).toEqual([30, 45, 60, 90]);
});

test("a new coach is sent only when it differs from the class's", () => {
  expect(editForm(session, Z).coachId).toBe("u1");
  expect(toPatch({ ...editForm(session, Z), coachId: "u1" }, session, Z, true)).toEqual({});
  expect(toPatch({ ...editForm(session, Z), coachId: "u2" }, session, Z, true)).toEqual({ coach_id: "u2" });
});

test("server answers become outcomes and messages", () => {
  expect(changeOutcome(403, "not_your_session")).toBe("notYours");
  expect(changeOutcome(409, "session_cancelled")).toBe("cancelled");
  expect(changeOutcome(409, "session_has_history")).toBe("hasHistory");
  expect(changeOutcome(422, "invalid_times")).toBe("badTimes");
  expect(changeOutcome(422, "invalid_coach")).toBe("badCoach");
  expect(changeMessage(t, "badCoach")).toBeTruthy();
  expect(changeOutcome(500, undefined)).toBe("error");
  expect(changeMessage(t, "ok")).toBeNull();
  expect(changeMessage(t, "badTimes")).toBeTruthy();
});

test("an owner changes any open class, a coach only their own, nobody a cancelled one", () => {
  expect(canChange(session, "owner", "u9")).toBe(true);
  expect(canChange(session, "coach", "u1")).toBe(true);
  expect(canChange(session, "coach", "u2")).toBe(false);
  expect(canChange(session, "member", "u1")).toBe(false);
  expect(canChange({ ...session, status: "cancelled" }, "owner", "u1")).toBe(false);
});

test("a class with history says to cancel it instead", () => {
  expect(changeMessage(t, "hasHistory")).toMatch(/Cancel it instead/);
});
