import { makeTranslator } from "@/i18n/translate";

import type { Series } from "./series";
import {
  actionOutcome,
  editedMessage,
  endedMessage,
  extendedMessage,
  failureMessage,
  seriesForm,
  seriesPatch,
} from "./series-actions";

const t = makeTranslator("en");
const ZONE = "Asia/Jerusalem";
const NOW = Date.parse("2026-10-29T10:20:00Z");
const series: Series = {
  id: "s1",
  class_type_id: "ct1",
  coach_id: "u1",
  weekday: 1,
  start_time: "18:00:00",
  duration_minutes: 60,
  capacity: 8,
  first_date: "2026-11-03",
  last_date: null,
};

test("the form starts as the series stands: clock, length, seats, coach", () => {
  expect(seriesForm(series, NOW, ZONE)).toMatchObject({ classTypeId: "ct1", hour: 18, minute: 0, duration: 60, seats: "8", coachId: "u1" });
  expect(seriesForm({ ...series, capacity: null, start_time: "07:05:00" }, NOW, ZONE)).toMatchObject({ hour: 7, minute: 5, seats: "" });
});

test("an untouched form has nothing to save", () => {
  expect(seriesPatch(seriesForm(series, NOW, ZONE), series, true)).toEqual({});
});

test("only what changed is sent, the start time as the studio's clock", () => {
  const form = { ...seriesForm(series, NOW, ZONE), hour: 9, minute: 5, duration: 90, coachId: "u2", seats: "12" };
  expect(seriesPatch(form, series, true)).toEqual({ start_time: "09:05", duration_minutes: 90, capacity: 12, coach_id: "u2" });
  expect(seriesPatch({ ...seriesForm(series, NOW, ZONE), hour: 19 }, series, true)).toEqual({ start_time: "19:00" });
});

test("emptied seats mean unlimited, an invalid number sends nothing, and hidden seats are left alone", () => {
  const form = seriesForm(series, NOW, ZONE);
  expect(seriesPatch({ ...form, seats: "" }, series, true)).toEqual({ capacity: null });
  expect(seriesPatch({ ...form, seats: "abc" }, series, true)).toEqual({});
  expect(seriesPatch({ ...form, seats: "20" }, series, false)).toEqual({});
});

test("a server answer becomes one outcome and one message", () => {
  expect(actionOutcome(404, "series_not_found")).toBe("gone");
  expect(actionOutcome(409, "session_time_clash")).toBe("clash");
  expect(actionOutcome(409, "series_has_history")).toBe("hasHistory");
  expect(actionOutcome(409, "series_not_started")).toBe("notStarted");
  expect(actionOutcome(422, "invalid_coach")).toBe("badCoach");
  expect(actionOutcome(500, "boom")).toBe("error");
  expect(failureMessage(t, "ok")).toBeNull();
  expect(failureMessage(t, "hasHistory")).toMatch(/End it instead/);
  expect(failureMessage(t, "notStarted")).toMatch(/Delete it instead/);
  expect(failureMessage(t, "clash")).toMatch(/start time/);
  expect(failureMessage(t, "unreachable")).toBe(t("common.cantReach"));
});

test("what each action reports", () => {
  expect(extendedMessage(t, 0)).toMatch(/Nothing to add/);
  expect(extendedMessage(t, 1)).toBe("1 class added.");
  expect(extendedMessage(t, 4)).toBe("4 classes added.");
  expect(endedMessage(t, { sessions_deleted: 3, sessions_cancelled: 1 })).toBe("Ended. 3 empty classes removed, 1 cancelled.");
  expect(editedMessage(t, { sessions_updated: 4, sessions_kept: 1 })).toBe("Saved. 4 upcoming classes updated, 1 left as changed by hand.");
});
