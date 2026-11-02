import { makeTranslator } from "@/i18n/translate";

import type { Series, SeriesSessionRow } from "./series";
import {
  actionOutcome,
  editedMessage,
  endedMessage,
  extendedMessage,
  failureMessage,
  seriesForm,
  seriesPatch,
  whatChanges,
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

const coming = (day: string, over: Partial<SeriesSessionRow> = {}): SeriesSessionRow => ({
  id: day,
  starts_at: `${day}T16:00:00Z`,
  ends_at: `${day}T17:00:00Z`,
  status: "scheduled",
  capacity: 8,
  going: 0,
  changed_by_hand: false,
  ...over,
});
const staff = [{ id: "u2", name: "Cody" }];
const four = [coming("2026-11-03"), coming("2026-11-10"), coming("2026-11-17", { changed_by_hand: true }), coming("2026-11-24", { status: "cancelled" })];

test("nothing edited, no box", () => {
  expect(whatChanges(t, {}, staff, four, ZONE)).toBeNull();
});

test("the classes that follow are counted; one changed by hand stays; a cancelled one is not mentioned", () => {
  expect(whatChanges(t, { start_time: "07:30" }, staff, four, ZONE)).toEqual({
    count: 2,
    text: "The 2 classes from Tue 3 Nov on will move to 07:30. Tue 17 Nov was changed by hand, so it stays as it is. Past classes don't change.",
  });
});

test("several changes are joined, each worded on its own", () => {
  const { text } = whatChanges(t, { start_time: "07:30", duration_minutes: 45, capacity: null, coach_id: "u2" }, staff, four, ZONE)!;
  expect(text).toContain("will move to 07:30, become 45 min long, become unlimited and have Cody as coach.");
  expect(whatChanges(t, { capacity: 1 }, staff, [coming("2026-11-03")], ZONE)!.text).toBe(
    "The class on Tue 3 Nov will get 1 seat. Past classes don't change.",
  );
});

test("when every coming class was changed by hand, none follows", () => {
  const hand = [coming("2026-11-03", { changed_by_hand: true }), coming("2026-11-10", { changed_by_hand: true })];
  expect(whatChanges(t, { capacity: 5 }, staff, hand, ZONE)).toEqual({
    count: 0,
    text: "No coming class follows this change; only the weekly rule changes. Tue 3 Nov, Tue 10 Nov were changed by hand, so they stay as they are. Past classes don't change.",
  });
});
