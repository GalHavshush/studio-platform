import { makeTranslator } from "@/i18n/translate";

import { clock, dateLabel, rangeLabel, seriesGroups, seriesRows, statusLabel, todayIn, weekdayName, type Series } from "./series";

const t = makeTranslator("en");
const series = (over: Partial<Series> = {}): Series => ({
  id: "s1",
  class_type_id: "ct1",
  coach_id: "u1",
  weekday: 1,
  start_time: "18:00:00",
  duration_minutes: 60,
  capacity: null,
  first_date: "2026-11-03",
  last_date: null,
  ...over,
});

test("the API's weekday numbers start on Monday", () => {
  expect([0, 1, 6].map((d) => weekdayName(d, t.locale))).toEqual(["Monday", "Tuesday", "Sunday"]);
});

test("the start time is shown as written, without seconds", () => {
  expect(clock("18:00:00")).toBe("18:00");
  expect(clock("07:05:00")).toBe("07:05");
});

test("a date is a calendar date: the phone's timezone cannot move it", () => {
  expect(dateLabel("2026-11-03", t.locale)).toBe("3 Nov 2026");
  expect(dateLabel("2027-01-01", t.locale)).toBe("1 Jan 2027");
});

test("a series without an end says from, and one with an end says both dates", () => {
  expect(rangeLabel(t, series())).toBe("From 3 Nov 2026");
  expect(rangeLabel(t, series({ last_date: "2026-11-24" }))).toBe("3 Nov 2026 to 24 Nov 2026");
});

test("a card names the class, the schedule, the coach and the dates", () => {
  const [row] = seriesRows(t, [series({ capacity: 12 })], [{ id: "ct1", name: "Yoga" }], [{ id: "u1", name: "Cody Coach" }]);

  expect(row).toEqual({
    id: "s1",
    title: "Yoga",
    when: "Every Tuesday · 18:00 · 60 min · 12 seats",
    coach: "Coach: Cody Coach",
    range: "From 3 Nov 2026",
  });
});

test("seats are left out when the class is unlimited, and one seat is singular", () => {
  const [none] = seriesRows(t, [series()], [], []);
  const [one] = seriesRows(t, [series({ capacity: 1 })], [], []);

  expect(none.when).toBe("Every Tuesday · 18:00 · 60 min");
  expect(one.when).toContain("1 seat");
  expect(one.when).not.toContain("1 seats");
});

test("a class type or coach that is not in the lists gets a plain fallback", () => {
  const [row] = seriesRows(t, [series()], [{ id: "other", name: "Pilates" }], [{ id: "other", name: "Someone" }]);

  expect(row.title).toBe("Unknown class type");
  expect(row.coach).toBe("Coach: Former coach");
});

test("every series gets its own card, in the order the API gave", () => {
  const rows = seriesRows(t, [series({ id: "b" }), series({ id: "a" })], [], []);

  expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
});

test("where a weekly class stands: not started, ongoing, running to a date, or ended", () => {
  const today = "2026-11-03";
  expect(statusLabel(t, series({ first_date: "2026-11-08" }), today)).toBe("starts 8 Nov");
  expect(statusLabel(t, series(), today)).toBe("ongoing");
  expect(statusLabel(t, series({ last_date: "2026-12-28" }), today)).toBe("until 28 Dec");
  expect(statusLabel(t, series({ last_date: "2026-10-27" }), today)).toBe("ended 27 Oct");
  expect(statusLabel(t, series({ last_date: "2026-11-03" }), today)).toBe("until 3 Nov"); // its last day is today
});

test("today is the studio's date, not the phone's", () => {
  const instant = Date.parse("2026-11-02T22:30:00Z"); // 3 Nov 00:30 in Jerusalem
  expect(todayIn(instant, "Asia/Jerusalem")).toBe("2026-11-03");
  expect(todayIn(instant, "UTC")).toBe("2026-11-02");
});

test("the list is grouped by weekday, by time inside a day, starting on the person's first day", () => {
  const list = [
    series({ id: "sun", weekday: 6, start_time: "07:00:00", coach_id: "u2", first_date: "2026-11-08" }),
    series({ id: "late", weekday: 1, start_time: "19:30:00" }),
    series({ id: "early", weekday: 1, start_time: "07:00:00" }),
  ];
  const types = [{ id: "ct1", name: "Yoga" }];
  const staff = [{ id: "u1", name: "Cody" }, { id: "u2", name: "Olivia" }];

  const monday = seriesGroups(t, list, types, staff, "2026-11-03", 1);
  expect(monday.map((g) => g.weekday)).toEqual(["Tuesday", "Sunday"]);
  expect(monday[0].rows.map((r) => r.id)).toEqual(["early", "late"]);
  expect(monday[0].rows[0]).toEqual({ id: "early", time: "07:00", title: "Yoga", note: "Cody · ongoing" });
  expect(monday[1].rows[0].note).toBe("Olivia · starts 8 Nov");

  expect(seriesGroups(t, list, types, staff, "2026-11-03", 0).map((g) => g.weekday)).toEqual(["Sunday", "Tuesday"]);
});
