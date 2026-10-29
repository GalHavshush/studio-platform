import { makeTranslator } from "@/i18n/translate";

import { dayDate, weekDays, weekRange, todayStates } from "./week";

const JERUSALEM = "Asia/Jerusalem";
const locale = makeTranslator("en").locale; // the locale the app formats dates with
const iso = (s: string) => Date.parse(s);

test("the week strip has seven days, Monday to Sunday, keyed like the sessions", () => {
  const days = weekDays(iso("2026-10-29T10:00:00Z"), JERUSALEM, locale); // Thu 29 Oct

  expect(days.map((d) => d.key)).toEqual([
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
  expect(days.map((d) => d.letter)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  expect(days[3].number).toBe("29");
  expect(days[3].label).toBe("Thursday 29 October");
});

test("a week with a clock change still has seven different days", () => {
  // Jerusalem went back on Sunday 25 Oct 2026, so the week of Mon 19 Oct holds the 25-hour day
  const days = weekDays(iso("2026-10-22T10:00:00Z"), JERUSALEM, locale);

  expect(days.map((d) => d.key)).toEqual([
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
});

test("the range names the first and last day of the week", () => {
  expect(weekRange(iso("2026-10-29T10:00:00Z"), JERUSALEM, locale)).toBe("26 Oct – 1 Nov");
});

const at = (id: string, endsAt: string, status = "scheduled") => ({ id, ends_at: endsAt, status });

test("finished classes are done, the first one still to run is next, the rest are later", () => {
  const now = iso("2026-10-29T10:00:00Z");
  const states = todayStates(
    [
      at("a", "2026-10-29T05:00:00Z"),
      at("b", "2026-10-29T11:00:00Z"),
      at("c", "2026-10-29T15:00:00Z"),
    ],
    now,
  );

  expect([...states]).toEqual([
    ["a", "done"],
    ["b", "next"],
    ["c", "later"],
  ]);
});

test("a class in progress is the next one", () => {
  const now = iso("2026-10-29T10:30:00Z");

  expect(todayStates([at("a", "2026-10-29T11:00:00Z")], now).get("a")).toBe("next");
});

test("a cancelled class is never next, and has no state", () => {
  const now = iso("2026-10-29T08:00:00Z");
  const states = todayStates([at("a", "2026-10-29T09:00:00Z", "cancelled"), at("b", "2026-10-29T15:00:00Z")], now);

  expect(states.has("a")).toBe(false);
  expect(states.get("b")).toBe("next");
});

test("when every class is over, none is next", () => {
  const now = iso("2026-10-29T20:00:00Z");

  expect([...todayStates([at("a", "2026-10-29T05:00:00Z")], now).values()]).toEqual(["done"]);
});

test("the date line names the weekday, day and month in the studio's zone", () => {
  expect(dayDate(iso("2026-10-28T22:30:00Z"), JERUSALEM, locale)).toBe("Thu 29 Oct");
});
