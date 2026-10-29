import { makeTranslator } from "@/i18n/translate";

import { entryStatus, mergePages, noteMeta, statusLabel, type TimelineEntry } from "./timeline";

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
