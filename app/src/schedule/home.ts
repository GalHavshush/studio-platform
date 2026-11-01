// What the member Home shows, kept apart from the screen so it can be tested.
import type { ScheduledSession } from "./use-schedule";
import { sharedNotes, type TimelineEntry, type TimelineNote } from "./timeline";

export const NEXT_CLASSES_LIMIT = 3;

/** The classes the member said they will (or may) come to, or waits for: still ahead, soonest first. */
export function nextClasses(sessions: ScheduledSession[], now: number) {
  return sessions
    .filter(
      (s) =>
        s.status !== "cancelled" &&
        Date.parse(s.starts_at) > now &&
        (s.my_rsvp === "going" || s.my_rsvp === "maybe" || s.my_rsvp === "waitlist"),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, NEXT_CLASSES_LIMIT);
}

/** The newest note a coach shared with the person, with the class it belongs to; null if there is none. */
// ponytail: looked for among the pages loaded (the newest 20 classes), which is where the latest one is.
export function latestCoachNote(entries: TimelineEntry[], now: number): { entry: TimelineEntry; note: TimelineNote } | null {
  for (const entry of entries) {
    if (entry.status === "cancelled" || Date.parse(entry.starts_at) > now) continue;
    const notes = sharedNotes(entry);
    if (notes.length === 0) continue;
    const note = notes.reduce((a, b) => (Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a));
    return { entry, note };
  }
  return null;
}
