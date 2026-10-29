// What the schedule needs to draw "the week we are in": the seven days for the week strip, the range
// under its title, and which of today's classes are over and which one is next.
import { HOUR, addDays, dayKey, startOfWeek, type FirstDay } from "./time";

export type WeekDay = {
  key: string; // dayKey of the day, the same key sessions group by
  start: number; // the studio's midnight that begins the day
  letter: string; // "M", "T", ...
  number: string; // the date, "29"
  label: string; // "Thursday 29 October", for a screen reader
};

/** The seven days of the week that contains `now`, from `firstDay`, in the studio's zone. */
export function weekDays(now: number, timeZone: string, locale: string, firstDay: FirstDay): WeekDay[] {
  const first = startOfWeek(now, timeZone, firstDay);
  const letter = new Intl.DateTimeFormat(locale, { timeZone, weekday: "narrow" });
  const number = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric" });
  const label = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" });
  return Array.from({ length: 7 }, (_, i) => {
    const start = addDays(first, i, timeZone);
    // Formatting the midnight itself would be exact too; midday keeps it far from a clock change.
    const at = new Date(start + 12 * HOUR);
    return {
      key: dayKey(start, timeZone),
      start,
      letter: letter.format(at),
      number: number.format(at),
      label: label.format(at),
    };
  });
}

/** "26 Oct – 1 Nov": the first and last day of the week that contains `now`. */
export function weekRange(now: number, timeZone: string, locale: string, firstDay: FirstDay): string {
  const first = startOfWeek(now, timeZone, firstDay);
  const day = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" });
  const at = (days: number) => new Date(addDays(first, days, timeZone) + 12 * HOUR);
  return `${day.format(at(0))} – ${day.format(at(6))}`;
}

export type TodayState = "done" | "next" | "later";

/**
 * For today's classes, in time order: "done" once a class has ended, "next" for the first one that
 * has not (in progress or still to come), "later" for the rest. A cancelled class gets no state.
 */
export function todayStates(
  sessions: { id: string; ends_at: string; status: string }[],
  now: number,
): Map<string, TodayState> {
  const states = new Map<string, TodayState>();
  let nextTaken = false;
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    if (Date.parse(s.ends_at) <= now) states.set(s.id, "done");
    else if (!nextTaken) {
      states.set(s.id, "next");
      nextTaken = true;
    } else states.set(s.id, "later");
  }
  return states;
}

/** "Thu 29 Oct": the date line on the Today card. */
export function dayDate(instant: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(instant),
  );
}
