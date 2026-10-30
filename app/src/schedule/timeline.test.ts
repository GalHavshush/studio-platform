import { makeTranslator } from "@/i18n/translate";

import { aboutYou, entryStatus, mergePages, noteMeta, sharedNotes, statusLabel, type TimelineEntry } from "./timeline";

const t = makeTranslator("en");
const NOW = Date.parse("2026-10-29T12:00:00Z");

const entry = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  session_id: "s1",
  starts_at: "2026-10-28T12:00:00Z",
  class_type_name: "Pilates",
  status: "scheduled",
  booking: null,
  attended: null,
  summary: null,
  notes: [],
  ...over,
});

test("a recorded answer decides, and a cancelled class is cancelled whatever else is recorded", () => {
  expect(entryStatus(entry({ attended: true }), NOW)).toBe("attended");
  expect(entryStatus(entry({ attended: false }), NOW)).toBe("missed");
  expect(entryStatus(entry({ status: "cancelled", attended: true }), NOW)).toBe("cancelled");
});

test("with nothing recorded a class ahead is upcoming and one that is over has no record", () => {
  expect(entryStatus(entry({ starts_at: "2026-10-29T12:00:01Z" }), NOW)).toBe("upcoming");
  expect(entryStatus(entry({ starts_at: "2026-10-29T12:00:00Z" }), NOW)).toBe("noRecord"); // started
  expect(entryStatus(entry({ starts_at: "2026-10-01T12:00:00Z" }), NOW)).toBe("noRecord");
});

test("each status has its own words", () => {
  const labels = (["cancelled", "attended", "missed", "upcoming", "noRecord"] as const).map((s) => statusLabel(t, s));

  expect(new Set(labels).size).toBe(5);
  expect(statusLabel(t, "missed")).toBe("Didn't attend");
});

test("a new page is added after the ones shown, and a class already shown is not repeated", () => {
  const a = entry({ session_id: "a" });
  const b = entry({ session_id: "b" });
  const c = entry({ session_id: "c" });

  expect(mergePages([a, b], [c]).map((e) => e.session_id)).toEqual(["a", "b", "c"]);
  expect(mergePages([a, b], [b, c]).map((e) => e.session_id)).toEqual(["a", "b", "c"]);
  expect(mergePages([], [a])).toEqual([a]);
  expect(mergePages([a], [])).toEqual([a]);
});

test("staff see who wrote a note and whether it is shared, and a member's note has no line", () => {
  const base = { id: "n", body: "x", created_at: "2026-10-28T12:00:00Z" };

  expect(noteMeta(t, { ...base, author_name: "Cody", shared_with_member: true })).toBe("Cody · Shared");
  expect(noteMeta(t, { ...base, author_name: "Olivia", shared_with_member: false })).toBe("Olivia · Staff only");
  expect(noteMeta(t, base)).toBeNull();
});

test("a note with only half the staff fields gets no line rather than a wrong one", () => {
  const base = { id: "n", body: "x", created_at: "2026-10-28T12:00:00Z" };

  expect(noteMeta(t, { ...base, author_name: "Cody" })).toBeNull(); // would read "Staff only" by mistake
  expect(noteMeta(t, { ...base, shared_with_member: true })).toBeNull();
});

// NOW is Thursday 29 Oct 2026, so with Monday weeks last week is Mon 19 Oct to Sun 25 Oct (UTC+3 until the
// 25th, then UTC+2): the studio's midnights are 2026-10-18T21:00Z and 2026-10-25T22:00Z.
const note = (id: string, shared?: boolean) => ({ id, body: id, created_at: "x", shared_with_member: shared });
const about = (entries: TimelineEntry[]) => aboutYou(entries, NOW, "Asia/Jerusalem", 1).map((e) => e.session_id);

test("last week means the calendar week before this one, to the minute", () => {
  const at = (id: string, starts_at: string) => entry({ session_id: id, starts_at, summary: "Good." });
  expect(
    about([
      at("before", "2026-10-18T20:59:00Z"),
      at("first", "2026-10-18T21:00:00Z"),
      at("last", "2026-10-25T21:59:00Z"),
      at("this-week", "2026-10-25T22:00:00Z"),
    ]),
  ).toEqual(["first", "last"]);
});

test("the week starts where the setting says: from Sunday, last week is 18 to 24 Oct", () => {
  const sunday = entry({ session_id: "sun", starts_at: "2026-10-18T10:00:00Z", summary: "Good." });
  expect(about([sunday])).toEqual([]);
  expect(aboutYou([sunday], NOW, "Asia/Jerusalem", 0).map((e) => e.session_id)).toEqual(["sun"]);
});

test("a class needs a summary or a shared note, only shared notes are kept, cancelled ones are left out", () => {
  const last = { starts_at: "2026-10-21T10:00:00Z" };
  const result = aboutYou(
    [
      entry({ ...last, session_id: "summary", summary: "Good." }),
      entry({ ...last, session_id: "private", notes: [note("n1", false)] }),
      entry({ ...last, session_id: "mixed", notes: [note("n2", false), note("n3", true)] }),
      entry({ ...last, session_id: "member", notes: [note("n4")] }),
      entry({ ...last, session_id: "cancelled", status: "cancelled", summary: "Good." }),
      entry({ ...last, session_id: "empty" }),
    ],
    NOW,
    "Asia/Jerusalem",
    1,
  );
  expect(result.map((e) => e.session_id)).toEqual(["summary", "mixed", "member"]);
  expect(result[1].notes.map((n) => n.id)).toEqual(["n3"]);
});

test("a note with no flag is kept, one marked private is not", () => {
  expect(sharedNotes({ notes: [note("a"), note("b", true), note("c", false)] }).map((n) => n.id)).toEqual(["a", "b"]);
});
