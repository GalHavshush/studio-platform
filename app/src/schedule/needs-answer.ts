import type { ScheduledSession } from "./use-schedule";

const WEEK = 7 * 24 * 60 * 60 * 1000;
export const NEEDS_ANSWER_LIMIT = 3;

// The classes a member has not answered yet: still to come within the week and not cancelled.
// A class that has started or is over never asks. `shown` is the first few, `more` the rest.
export function needsAnswer(sessions: ScheduledSession[], now: number) {
  const open = sessions
    .filter((s) => {
      const start = Date.parse(s.starts_at);
      return s.status !== "cancelled" && s.my_rsvp === null && start > now && start <= now + WEEK;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return { shown: open.slice(0, NEEDS_ANSWER_LIMIT), more: Math.max(0, open.length - NEEDS_ANSWER_LIMIT) };
}
