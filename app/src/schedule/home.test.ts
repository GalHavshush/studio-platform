import { latestCoachNote, nextClasses } from "./home";
import type { TimelineEntry } from "./timeline";
import type { ScheduledSession } from "./use-schedule";

const NOW = Date.parse("2026-11-01T12:00:00Z");

const session = (id: string, starts_at: string, over: Partial<ScheduledSession> = {}) =>
  ({ id, starts_at, status: "scheduled", my_rsvp: null, ...over }) as ScheduledSession;
const entry = (id: string, starts_at: string, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  session_id: id,
  starts_at,
  class_type_name: "Spin",
  status: "scheduled",
  booking: null,
  attended: null,
  summary: null,
  notes: [],
  ...over,
});
const note = (id: string, created_at: string, shared?: boolean) => ({ id, body: id, created_at, shared_with_member: shared });

test("next classes are the answered ones still ahead, soonest first, never cancelled or answered no", () => {
  const sessions = [
    session("late", "2026-11-04T09:00:00Z", { my_rsvp: "maybe" }),
    session("soon", "2026-11-02T09:00:00Z", { my_rsvp: "going" }),
    session("wait", "2026-11-03T09:00:00Z", { my_rsvp: "waitlist" }),
    session("no", "2026-11-02T10:00:00Z", { my_rsvp: "not_going" }),
    session("open", "2026-11-02T11:00:00Z"),
    session("cancelled", "2026-11-02T12:00:00Z", { my_rsvp: "going", status: "cancelled" }),
    session("past", "2026-11-01T11:00:00Z", { my_rsvp: "going" }),
  ];

  expect(nextClasses(sessions, NOW).map((s) => s.id)).toEqual(["soon", "wait", "late"]);
});

test("only the first three next classes are shown", () => {
  const many = ["a", "b", "c", "d"].map((id, i) => session(id, `2026-11-0${i + 2}T09:00:00Z`, { my_rsvp: "going" }));

  expect(nextClasses(many, NOW)).toHaveLength(3);
});

test("the latest note is the newest shared one of the newest class that has one", () => {
  const entries = [
    entry("future", "2026-11-05T09:00:00Z", { notes: [note("f", "2026-11-01T00:00:00Z")] }),
    entry("private", "2026-10-30T09:00:00Z", { notes: [note("p", "2026-10-30T10:00:00Z", false)] }),
    entry("recent", "2026-10-28T09:00:00Z", { notes: [note("old", "2026-10-28T10:00:00Z"), note("new", "2026-10-29T10:00:00Z")] }),
    entry("older", "2026-10-20T09:00:00Z", { notes: [note("o", "2026-10-20T10:00:00Z")] }),
  ];
  const found = latestCoachNote(entries, NOW);

  expect(found?.entry.session_id).toBe("recent");
  expect(found?.note.id).toBe("new");
});

test("with no shared note there is nothing to show", () => {
  expect(latestCoachNote([entry("a", "2026-10-28T09:00:00Z")], NOW)).toBeNull();
});
