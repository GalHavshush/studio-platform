// The classes waiting for a report, a week at a time (the API caps a range at 62 days).
import type { components } from "@/api/schema";

import { addDays, startOfWeek, type FirstDay } from "./time";

export type QueueItem = components["schemas"]["QueueItem"];

/** The week that is `weeksBack` weeks before the one containing `now`: [from, to) as instants. */
export function queueWeek(now: number, timeZone: string, firstDay: FirstDay, weeksBack: number) {
  const thisWeek = startOfWeek(now, timeZone, firstDay);
  const from = addDays(thisWeek, -7 * weeksBack, timeZone);
  return { from, to: addDays(from, 7, timeZone) };
}

/** Classes still without a report first; inside each group the API's order (newest first) is kept. */
export const unwrittenFirst = (items: QueueItem[]): QueueItem[] =>
  [...items].sort((a, b) => Number(a.has_report) - Number(b.has_report));
