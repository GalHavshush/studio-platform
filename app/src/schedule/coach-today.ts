// What the coach's Today shows, kept apart from the screen so it can be tested.
import type { ScheduledSession } from "./use-schedule";
import { dayKey } from "./time";

export const REPORTS_ON_TODAY = 3;

/** The coach's own classes today that still count (not cancelled), in time order. */
export function todaysClasses(sessions: ScheduledSession[], coachId: string, now: number, timeZone: string) {
  const today = dayKey(now, timeZone);
  return sessions
    .filter((s) => s.coach_id === coachId && s.status !== "cancelled" && dayKey(Date.parse(s.starts_at), timeZone) === today)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

/** The class that is on or next (a class still running is "next": that is when attendance is taken), then the rest of today. */
export function splitToday(classes: ScheduledSession[], now: number) {
  const at = classes.findIndex((s) => Date.parse(s.ends_at) > now);
  return at === -1 ? { next: null, later: [] } : { next: classes[at], later: classes.slice(at + 1) };
}

/** Whole minutes until the class starts; 0 once it has started. */
export const minutesUntil = (startsAt: string, now: number) => Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 60_000));
