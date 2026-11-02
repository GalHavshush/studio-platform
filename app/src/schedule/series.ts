// How a weekly class (a series) is worded in the "Weekly classes" list, kept apart from the screen so it can
// be tested. Every function that words something takes the translator `t` first.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import { dayKey, formatDay, startOfDay, type FirstDay } from "./time";

export type Series = components["schemas"]["SeriesOut"];

type Named = { id: string; name: string };

/** "Tuesday" for the API's weekday number (0 is Monday, 6 is Sunday), in the language's own words. */
export function weekdayName(weekday: number, locale: string): string {
  // 1 January 2024 was a Monday, and a date in UTC reads the same name whatever the phone's timezone
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1 + weekday));
}

/** "18:00" for the API's "18:00:00": the studio's wall clock, never converted. */
export const clock = (startTime: string): string => startTime.slice(0, 5);

/** "3 Nov 2026" for the API's "2026-11-03": a calendar date, so no timezone shifts it. */
export const dateLabel = (isoDate: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    Date.parse(isoDate),
  );

/** "8 Nov" for a calendar date: the list is about now, so no year. */
export const dayMonth = (isoDate: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.parse(isoDate));

/** Today's calendar date ("2026-11-03") on the studio's wall clock; the sv locale writes dates the ISO way. */
export const todayIn = (now: number, timeZone: string): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone }).format(now);

/** "ongoing", "until 28 Dec", "starts 8 Nov" or "ended 28 Dec": where the weekly class stands today. */
export function statusLabel(t: Translator, series: Series, today: string): string {
  if (series.first_date > today) return t("series.starts", { date: dayMonth(series.first_date, t.locale) });
  if (series.last_date === null) return t("series.ongoing");
  const date = dayMonth(series.last_date, t.locale);
  return t(series.last_date < today ? "series.ended" : "series.until", { date });
}

export type SeriesGroup = { weekday: string; rows: { id: string; time: string; title: string; note: string }[] };

/**
 * The list as the design draws it: a heading per weekday (starting on the day the person's week starts),
 * the classes of that day by time, each with its coach and where it stands. Days with none are left out.
 */
export function seriesGroups(
  t: Translator,
  series: Series[],
  types: Named[],
  staff: Named[],
  today: string,
  firstDay: FirstDay,
): SeriesGroup[] {
  const order = firstDay === 0 ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]; // the API's weekday 0 is Monday
  return order
    .map((weekday) => ({
      weekday: weekdayName(weekday, t.locale),
      rows: series
        .filter((s) => s.weekday === weekday)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((s) => ({
          id: s.id,
          time: clock(s.start_time),
          title: types.find((type) => type.id === s.class_type_id)?.name ?? t("series.unknownType"),
          note: `${staff.find((person) => person.id === s.coach_id)?.name ?? t("series.formerCoach")} · ${statusLabel(t, s, today)}`,
        })),
    }))
    .filter((group) => group.rows.length > 0);
}

export type SeriesSessionRow = components["schemas"]["SeriesSessionOut"];

export type SeriesFacts = { every: string; time: string; title: string; rows: { label: string; value: string }[] };

/** The top of the weekly class page: when it repeats, its name, and the rule's rows (the end date only when it has one). */
export function seriesFacts(t: Translator, series: Series, types: Named[], staff: Named[]): SeriesFacts {
  return {
    every: t("series.every", { day: weekdayName(series.weekday, t.locale) }),
    time: clock(series.start_time),
    title: types.find((type) => type.id === series.class_type_id)?.name ?? t("series.unknownType"),
    rows: [
      { label: t("seriesScreen.coach"), value: staff.find((person) => person.id === series.coach_id)?.name ?? t("series.formerCoach") },
      { label: t("seriesScreen.length"), value: t("series.minutes", { count: series.duration_minutes }) },
      { label: t("seriesScreen.seats"), value: series.capacity === null ? t("seriesScreen.unlimited") : String(series.capacity) },
      { label: t("seriesScreen.since"), value: dayMonth(series.first_date, t.locale) },
      ...(series.last_date === null ? [] : [{ label: t("seriesScreen.until"), value: dayMonth(series.last_date, t.locale) }]),
    ],
  };
}

export type ComingRow = { id: string; day: string; note: string; cancelled: boolean };

/** The "Coming up" rows: the day, and "12 of 20" (or "12 going" with no seat limit) or "Cancelled". */
export function comingRows(t: Translator, sessions: SeriesSessionRow[], now: number, timeZone: string): ComingRow[] {
  return sessions.map((s) => {
    const cancelled = s.status === "cancelled";
    const going = s.capacity === null ? t("seriesScreen.going", { count: s.going }) : t("seriesScreen.goingOf", { count: s.going, seats: s.capacity });
    return {
      id: s.id,
      day: formatDay(startOfDay(Date.parse(s.starts_at), timeZone), now, timeZone, t),
      note: cancelled ? t("common.cancelled") : going,
      cancelled,
    };
  });
}

/** "Scheduled to 29 Dec": the day of the last class that is not cancelled; null when none is left. */
export function scheduledTo(t: Translator, sessions: SeriesSessionRow[], timeZone: string): string | null {
  const last = sessions.filter((s) => s.status !== "cancelled").at(-1);
  return last ? t("seriesScreen.scheduledTo", { date: dayMonth(dayKey(Date.parse(last.starts_at), timeZone), t.locale) }) : null;
}
