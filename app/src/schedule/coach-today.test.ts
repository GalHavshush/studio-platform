import { minutesUntil, splitToday, todaysClasses } from "./coach-today";
import type { ScheduledSession } from "./use-schedule";

const at = (h: number) => `2026-11-03T${String(h).padStart(2, "0")}:00:00Z`;
const make = (id: string, start: number, over: Partial<ScheduledSession> = {}) =>
  ({ id, coach_id: "me", status: "scheduled", starts_at: at(start), ends_at: at(start + 1), ...over }) as ScheduledSession;
const now = Date.parse(at(8));

test("today holds only my classes of the day that are not cancelled, in time order", () => {
  const list = [
    make("late", 19),
    make("early", 7),
    make("other-coach", 9, { coach_id: "someone" }),
    make("cancelled", 10, { status: "cancelled" }),
    make("tomorrow", 7, { starts_at: "2026-11-04T07:00:00Z", ends_at: "2026-11-04T08:00:00Z" }),
  ];
  expect(todaysClasses(list, "me", now, "UTC").map((s) => s.id)).toEqual(["early", "late"]);
});

test("a class that is running is still the next one; the rest are later", () => {
  const list = [make("done", 6), make("running", 7, { ends_at: at(9) }), make("later", 12), make("last", 19)];
  const { next, later } = splitToday(list, now);
  expect(next?.id).toBe("running");
  expect(later.map((s) => s.id)).toEqual(["later", "last"]);
});

test("nothing left today gives no next class", () => {
  expect(splitToday([make("done", 6)], now)).toEqual({ next: null, later: [] });
});

test("minutes until a class count up and stop at zero", () => {
  expect(minutesUntil(at(9), now)).toBe(60);
  expect(minutesUntil(at(7), now)).toBe(0);
});
