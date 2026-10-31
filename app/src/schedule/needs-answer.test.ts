import { needsAnswer } from "./needs-answer";
import type { ScheduledSession } from "./use-schedule";

const NOW = Date.parse("2026-11-03T10:00:00Z");
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const session = (id: string, startsInHours: number, extra: Partial<ScheduledSession> = {}) =>
  ({ id, starts_at: hours(startsInHours), status: "scheduled", my_rsvp: null, ...extra }) as ScheduledSession;

test("an unanswered class that has not started asks, the earliest first", () => {
  const { shown, more } = needsAnswer([session("b", 30), session("a", 2)], NOW);
  expect(shown.map((s) => s.id)).toEqual(["a", "b"]);
  expect(more).toBe(0);
});

test("a class that has started or is over never asks", () => {
  const { shown } = needsAnswer([session("started", -1), session("over", -30), session("ok", 1)], NOW);
  expect(shown.map((s) => s.id)).toEqual(["ok"]);
});

test("an answered or cancelled class, or one beyond a week, does not ask", () => {
  const { shown } = needsAnswer(
    [
      session("answered", 3, { my_rsvp: "maybe" }),
      session("cancelled", 3, { status: "cancelled" }),
      session("far", 24 * 8),
    ],
    NOW,
  );
  expect(shown).toEqual([]);
});

test("only three are shown and the rest are counted", () => {
  const { shown, more } = needsAnswer([1, 2, 3, 4, 5].map((h) => session(`s${h}`, h)), NOW);
  expect(shown).toHaveLength(3);
  expect(more).toBe(2);
});
