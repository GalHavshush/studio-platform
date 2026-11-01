import { makeTranslator } from "@/i18n/translate";

import { groupPast, monthStats, pastLine, splitByNow } from "./my-classes";
import type { TimelineEntry } from "./timeline";

const t = makeTranslator("en");
const NOW = Date.parse("2026-10-29T12:00:00Z"); // a Thursday
const Z = "UTC";

const entry = (id: string, starts_at: string, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  session_id: id,
  starts_at,
  class_type_name: "Pilates",
  status: "scheduled",
  booking: null,
  attended: null,
  summary: null,
  notes: [],
  ...over,
});
const note = { id: "n", body: "x", created_at: "2026-10-27T00:00:00Z" };

test("classes ahead come soonest first and the rest keep their newest-first order", () => {
  const items = [entry("c", "2026-11-05T09:00:00Z"), entry("b", "2026-10-30T09:00:00Z"), entry("a", "2026-10-28T09:00:00Z")];
  const { upcoming, past } = splitByNow(items, NOW);

  expect(upcoming.map((e) => e.session_id)).toEqual(["b", "c"]);
  expect(past.map((e) => e.session_id)).toEqual(["a"]);
});

test("the month counts attended classes and shared notes, and leaves other months out", () => {
  const items = [
    entry("a", "2026-10-27T09:00:00Z", { attended: true, notes: [note, { ...note, id: "m", shared_with_member: false }] }),
    entry("b", "2026-10-02T09:00:00Z", { attended: true }),
    entry("c", "2026-10-03T09:00:00Z", { attended: false }),
    entry("d", "2026-09-30T09:00:00Z", { attended: true, notes: [note] }),
  ];

  expect(monthStats(items, NOW, Z)).toEqual({ attended: 2, notes: 1 });
});

test("past classes group under this week, then earlier in this month, then other months by name", () => {
  const past = [
    entry("a", "2026-10-27T09:00:00Z"),
    entry("b", "2026-10-26T09:00:00Z"),
    entry("c", "2026-10-20T09:00:00Z"),
    entry("d", "2026-09-30T09:00:00Z"),
  ];
  const groups = groupPast(past, NOW, Z, 1, t);

  expect(groups.map((g) => g.label)).toEqual(["This week", "Earlier in October", "September 2026"]);
  expect(groups.map((g) => g.entries.length)).toEqual([2, 1, 1]);
});

test("the line under a past class says what there is to read, else what the person had said", () => {
  expect(pastLine(t, entry("a", "2026-10-27T09:00:00Z", { summary: "s", notes: [note] }))).toBe("Summary · note for you");
  expect(pastLine(t, entry("a", "2026-10-27T09:00:00Z", { summary: "s" }))).toBe("Summary");
  expect(pastLine(t, entry("a", "2026-10-27T09:00:00Z", { notes: [note] }))).toBe("Note for you");
  expect(pastLine(t, entry("a", "2026-10-27T09:00:00Z", { booking: "going" }))).toBe("You said Going");
  expect(pastLine(t, entry("a", "2026-10-27T09:00:00Z"))).toBeNull();
});
