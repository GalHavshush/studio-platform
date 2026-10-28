// Sessions are UTC instants. These helpers show them the way the studio means them, in the studio's
// timezone (an IANA name such as "Asia/Jerusalem"), whatever timezone the phone is set to.
// Intl does the zone rules (including daylight saving); no date library is needed.
import type { Translator } from "@/i18n/translate";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(instant: number, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// How far the studio's clock is ahead of UTC at this instant, in milliseconds.
function offsetAt(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant the studio's calendar day containing `instant` begins (its local midnight). */
export function startOfDay(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const midnightAsIfUtc = Date.UTC(p.year, p.month - 1, p.day);
  // The offset may differ at midnight than at `instant` (a clock change in between), so the guess
  // is corrected once with the offset found at the guess.
  const guess = midnightAsIfUtc - offsetAt(instant, timeZone);
  return midnightAsIfUtc - offsetAt(guess, timeZone);
}

/** The studio's midnight `days` calendar days after (or before, if negative) the one of `instant`. */
export function addDays(instant: number, days: number, timeZone: string): number {
  // Midday of the target day is far from any clock change, so it lands on the right date.
  return startOfDay(startOfDay(instant, timeZone) + days * DAY + 12 * HOUR, timeZone);
}

/** A stable key for the studio's calendar day of `instant` ("2026-10-28"): sessions group by it. */
export function dayKey(instant: number, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatTime(instant: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

/** "Today", "Tomorrow" or e.g. "Thu 30 Oct", for the day starting at `dayStart`. */
export function formatDay(dayStart: number, now: number, timeZone: string, t: Translator): string {
  const today = startOfDay(now, timeZone);
  if (dayStart === today) return t("day.today");
  if (dayStart === addDays(today, 1, timeZone)) return t("day.tomorrow");
  return new Intl.DateTimeFormat(t.locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(dayStart));
}

const dateFormat = (instant: number, timeZone: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(instant),
  );

/** "Tue 3 Nov, 01:00-02:00", or with both dates when the session ends on another studio day. */
export function formatRange(start: number, end: number, timeZone: string, locale: string): string {
  const from = `${dateFormat(start, timeZone, locale)}, ${formatTime(start, timeZone, locale)}`;
  if (dayKey(start, timeZone) === dayKey(end, timeZone)) {
    return `${from}\u2013${formatTime(end, timeZone, locale)}`;
  }
  return `${from} \u2013 ${dateFormat(end, timeZone, locale)}, ${formatTime(end, timeZone, locale)}`;
}
