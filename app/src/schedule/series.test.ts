import { makeTranslator } from "@/i18n/translate";

import { clock, comingRows, dateLabel, scheduledTo, seriesFacts, seriesGroups, statusLabel, todayIn, weekdayName, type Series, type SeriesSessionRow } from "./series";

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

const types = [{ id: "ct1", name: "Yoga" }];
const staff = [{ id: "u1", name: "Cody" }];

test("the weekly class page names the rule and shows the end date only when there is one", () => {
  const facts = seriesFacts(t, series({ capacity: 20 }), types, staff);
  expect(facts).toMatchObject({ every: "Every Tuesday", time: "18:00", title: "Yoga" });
  expect(facts.rows).toEqual([
    { label: "Coach", value: "Cody" },
    { label: "Length", value: "60 min" },
    { label: "Seats", value: "20" },
    { label: "Since", value: "3 Nov" },
  ]);
  const ended = seriesFacts(t, series({ last_date: "2026-12-29" }), types, staff).rows;
  expect(ended.at(-1)).toEqual({ label: "Until", value: "29 Dec" });
  expect(ended.find((r) => r.label === "Seats")?.value).toBe("Unlimited");
});

test("a missing class type or coach gets a plain fallback", () => {
  const facts = seriesFacts(t, series(), [], []);
  expect(facts.title).toBe("Unknown class type");
  expect(facts.rows[0].value).toBe("Former coach");
});

const coming = (over: Partial<SeriesSessionRow> = {}): SeriesSessionRow => ({
  id: "x",
  starts_at: "2026-11-03T05:00:00Z",
  ends_at: "2026-11-03T06:00:00Z",
  status: "scheduled",
  capacity: 20,
  going: 12,
  changed_by_hand: false,
  ...over,
});
const NOW = Date.parse("2026-11-01T10:00:00Z");

test("a coming class reads 12 of 20, 12 going without a seat limit, or Cancelled", () => {
  const rows = comingRows(t, [coming(), coming({ capacity: null }), coming({ status: "cancelled" })], NOW, "UTC");
  expect(rows.map((r) => r.note)).toEqual(["12 of 20", "12 going", "Cancelled"]);
  expect(rows.map((r) => r.cancelled)).toEqual([false, false, true]);
  expect(rows[0].day).toBe("Tue 3 Nov");
});

test("a class today or tomorrow says so", () => {
  const rows = comingRows(t, [coming({ starts_at: "2026-11-01T18:00:00Z" }), coming({ starts_at: "2026-11-02T07:00:00Z" })], NOW, "UTC");
  expect(rows.map((r) => r.day)).toEqual(["Today", "Tomorrow"]);
});

test("scheduled to the last class that is not cancelled", () => {
  const list = [coming(), coming({ starts_at: "2026-12-29T05:00:00Z" }), coming({ starts_at: "2027-01-05T05:00:00Z", status: "cancelled" })];
  expect(scheduledTo(t, list, "UTC")).toBe("Scheduled to 29 Dec");
  expect(scheduledTo(t, [coming({ status: "cancelled" })], "UTC")).toBeNull();
  expect(scheduledTo(t, [], "UTC")).toBeNull();
});
