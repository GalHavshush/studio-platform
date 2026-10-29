import { queueWeek, unwrittenFirst, type QueueItem } from "./report-queue";

const NOW = Date.parse("2026-10-29T10:00:00Z"); // a Thursday

test("the week is Monday to Monday in the studio's zone, and weeksBack steps whole weeks", () => {
  const w0 = queueWeek(NOW, "Asia/Jerusalem", 1, 0);
  expect(new Date(w0.from).toISOString()).toBe("2026-10-25T22:00:00.000Z"); // Mon 26 Oct 00:00, UTC+2
  expect(new Date(w0.to).toISOString()).toBe("2026-11-01T22:00:00.000Z");
  const w1 = queueWeek(NOW, "Asia/Jerusalem", 1, 1);
  expect(w1.to).toBe(w0.from);
});

test("a week that crosses a clock change is still seven calendar days", () => {
  // Israel left summer time on Sun 25 Oct 2026, so the week of Mon 19 Oct is 7 days plus an hour
  const { from, to } = queueWeek(NOW, "Asia/Jerusalem", 1, 1);
  expect((to - from) / 3_600_000).toBe(169);
});

test("unwritten classes come first, each group keeping its order", () => {
  const item = (id: string, has_report: boolean) => ({ session_id: id, has_report }) as QueueItem;
  const sorted = unwrittenFirst([item("a", true), item("b", false), item("c", true), item("d", false)]);
  expect(sorted.map((i) => i.session_id)).toEqual(["b", "d", "a", "c"]);
});
