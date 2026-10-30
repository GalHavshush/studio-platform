// The display rules of a person's timeline, kept apart from the screen so they can be tested.
// Every function that words something takes the translator `t` first.
import type { Translator } from "@/i18n/translate";

import { addDays, startOfWeek, type FirstDay } from "./time";

// One note as the timeline shows it. A member's notes have only the first three fields: the
// server leaves out the author and the flag for them, and the app shows what is there.
export type TimelineNote = {
  id: string;
  body: string;
  created_at: string;
  author_name?: string;
  shared_with_member?: boolean;
};

export type TimelineEntry = {
  session_id: string;
  starts_at: string;
  class_type_name: string;
  status: string;
  booking: string | null;
  attended: boolean | null;
  summary: string | null;
  notes: TimelineNote[];
};

export type EntryStatus = "cancelled" | "attended" | "missed" | "upcoming" | "noRecord";

/**
 * What happened to this person in this class. A cancelled class is cancelled whatever else is
 * recorded; otherwise the recorded fact decides; with nothing recorded it is still ahead
 * (upcoming) or over with nobody having said (no record).
 */
export function entryStatus(entry: Pick<TimelineEntry, "status" | "attended" | "starts_at">, now: number): EntryStatus {
  if (entry.status === "cancelled") return "cancelled";
  if (entry.attended === true) return "attended";
  if (entry.attended === false) return "missed";
  return Date.parse(entry.starts_at) > now ? "upcoming" : "noRecord";
}

export function statusLabel(t: Translator, status: EntryStatus): string {
  switch (status) {
    case "cancelled":
      return t("common.cancelled");
    case "attended":
      return t("timeline.attended");
    case "missed":
      return t("timeline.missed");
    case "upcoming":
      return t("timeline.upcoming");
    case "noRecord":
      return t("timeline.noRecord");
  }
}

/** The pages loaded so far followed by a new one; a class already shown is not shown twice. */
export function mergePages(shown: TimelineEntry[], next: TimelineEntry[]): TimelineEntry[] {
  const seen = new Set(shown.map((e) => e.session_id));
  return [...shown, ...next.filter((e) => !seen.has(e.session_id))];
}

/** The small line under a note for staff: who wrote it and whether the member can read it. A
 * member's notes carry neither, so they get no line. */
export function noteMeta(t: Translator, note: TimelineNote): string | null {
  if (note.author_name === undefined || note.shared_with_member === undefined) return null;
  return t("timeline.noteMeta", {
    name: note.author_name,
    kind: t(note.shared_with_member ? "timeline.shared" : "timeline.staffOnly"),
  });
}

/** The notes a member may read: a member's own notes carry no flag (the server already left the
 * private ones out); on a staff member's own timeline the flag decides. */
export const sharedNotes = (entry: Pick<TimelineEntry, "notes">): TimelineNote[] =>
  entry.notes.filter((n) => n.shared_with_member !== false);

/**
 * "Reports about you": the classes of last calendar week (the week before the one containing `now`,
 * in the studio's zone, from `firstDay`) that have a summary or a note shared with the person. The
 * entries come back with only the shared notes. A cancelled class has no report to show.
 */
export function aboutYou(entries: TimelineEntry[], now: number, timeZone: string, firstDay: FirstDay): TimelineEntry[] {
  const to = startOfWeek(now, timeZone, firstDay);
  const from = addDays(to, -7, timeZone);
  return entries
    .filter((e) => e.status !== "cancelled" && Date.parse(e.starts_at) >= from && Date.parse(e.starts_at) < to)
    .map((e) => ({ ...e, notes: sharedNotes(e) }))
    .filter((e) => e.summary || e.notes.length > 0);
}
