import { addDays, dayKey, formatDay, formatRange, formatTime, startOfDay } from "./time";

const JERUSALEM = "Asia/Jerusalem"; // UTC+3 in summer (until the last Sunday of October), UTC+2 after
const NEW_YORK = "America/New_York";
const iso = (s: string) => Date.parse(s);

test("the start of the day is the studio's midnight, not the UTC one", () => {
  // 22:30 UTC on 28 Oct is 00:30 on the 29th in Jerusalem (UTC+2 after the clocks went back)
  const instant = iso("2026-10-28T22:30:00Z");

  expect(startOfDay(instant, JERUSALEM)).toBe(iso("2026-10-28T22:00:00Z"));
  expect(startOfDay(instant, "UTC")).toBe(iso("2026-10-28T00:00:00Z"));
});

test("the same instant falls on different days in different timezones", () => {
  const instant = iso("2026-10-28T23:30:00Z");

  expect(dayKey(instant, JERUSALEM)).toBe("2026-10-29");
  expect(dayKey(instant, NEW_YORK)).toBe("2026-10-28");
});

test("a session just before and just after the studio's midnight are on different days", () => {
  const before = iso("2026-10-28T21:59:00Z"); // 23:59 in Jerusalem
  const after = iso("2026-10-28T22:00:00Z"); // 00:00 the next day

  expect(dayKey(before, JERUSALEM)).toBe("2026-10-28");
  expect(dayKey(after, JERUSALEM)).toBe("2026-10-29");
});

test("times are shown in the studio's timezone", () => {
  const instant = iso("2026-10-28T15:30:00Z");

  expect(formatTime(instant, JERUSALEM)).toBe("17:30");
  expect(formatTime(instant, NEW_YORK)).toBe("11:30");
});

test("a day with a clock change is 25 hours long and addDays still lands on midnight", () => {
  // Jerusalem went back one hour on Sunday 25 Oct 2026 (03:00 -> 02:00)
  const sat = startOfDay(iso("2026-10-24T12:00:00Z"), JERUSALEM);
  const sun = startOfDay(iso("2026-10-25T12:00:00Z"), JERUSALEM);
  const mon = startOfDay(iso("2026-10-26T12:00:00Z"), JERUSALEM);

  expect(sun - sat).toBe(24 * 3600 * 1000);
  expect(mon - sun).toBe(25 * 3600 * 1000);
  expect(addDays(sat, 2, JERUSALEM)).toBe(mon);
  expect(addDays(mon, -2, JERUSALEM)).toBe(sat);
});

test("addDays across a spring clock change in New York", () => {
  // 8 Mar 2026 is the 23-hour day
  const start = startOfDay(iso("2026-03-07T12:00:00Z"), NEW_YORK);

  expect(addDays(start, 1, NEW_YORK)).toBe(iso("2026-03-08T05:00:00Z"));
  expect(addDays(start, 2, NEW_YORK)).toBe(iso("2026-03-09T04:00:00Z"));
});

test("days are named Today and Tomorrow in the studio's calendar", () => {
  const now = iso("2026-10-28T22:30:00Z"); // already the 29th in Jerusalem
  const today = startOfDay(now, JERUSALEM);

  expect(formatDay(today, now, JERUSALEM)).toBe("Today");
  expect(formatDay(addDays(today, 1, JERUSALEM), now, JERUSALEM)).toBe("Tomorrow");
  expect(formatDay(addDays(today, 2, JERUSALEM), now, JERUSALEM)).toBe("Sat 31 Oct");
});

test("a range on one day shows the date once and both times in the studio's zone", () => {
  const start = iso("2026-11-02T23:00:00Z"); // 01:00 on the 3rd in Jerusalem
  const end = iso("2026-11-03T00:00:00Z");

  expect(formatRange(start, end, JERUSALEM)).toBe("Tue 3 Nov, 01:00\u201302:00");
});

test("the same range in another zone shows that zone's day and times", () => {
  const start = iso("2026-11-02T23:00:00Z");
  const end = iso("2026-11-03T00:00:00Z");

  expect(formatRange(start, end, NEW_YORK)).toBe("Mon 2 Nov, 18:00\u201319:00");
});

test("a session that ends on the next studio day shows both dates", () => {
  const start = iso("2026-11-03T21:30:00Z"); // 23:30 on the 3rd in Jerusalem
  const end = iso("2026-11-03T22:30:00Z"); // 00:30 on the 4th

  expect(formatRange(start, end, JERUSALEM)).toBe("Tue 3 Nov, 23:30 \u2013 Wed 4 Nov, 00:30");
});

test("a range across the clock change shows the times of the studio's clock", () => {
  // 25 Oct 2026: Jerusalem goes back at 03:00 (00:00 UTC). 22:00Z on the 24th is 01:00 (UTC+3).
  const start = iso("2026-10-24T22:00:00Z");
  const end = iso("2026-10-25T01:30:00Z"); // 03:30 (UTC+2) after the change

  expect(formatRange(start, end, JERUSALEM)).toBe("Sun 25 Oct, 01:00\u201303:30");
});
