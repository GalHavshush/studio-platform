// How a weekly class (a series) is worded in the "Weekly classes" list, kept apart from the screen so it can
// be tested. Every function that words something takes the translator `t` first.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import type { FirstDay } from "./time";

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

/** "From 3 Nov 2026", or "3 Nov 2026 to 24 Nov 2026" once the series has an end. */
export const rangeLabel = (t: Translator, series: Series): string =>
  series.last_date === null
    ? t("series.from", { from: dateLabel(series.first_date, t.locale) })
    : t("series.fromTo", { from: dateLabel(series.first_date, t.locale), to: dateLabel(series.last_date, t.locale) });

export type SeriesRow = { id: string; title: string; when: string; coach: string; range: string };

/**
 * What each card shows. The class type and the coach come as ids; a name that is not in the lists
 * (the type was removed, the coach left the studio) gets a plain fallback instead of an empty line.
 */
export function seriesRows(t: Translator, series: Series[], types: Named[], staff: Named[]): SeriesRow[] {
  return series.map((s) => ({
    id: s.id,
    title: types.find((type) => type.id === s.class_type_id)?.name ?? t("series.unknownType"),
    when: [
      t("series.every", { day: weekdayName(s.weekday, t.locale) }),
      clock(s.start_time),
      t("series.minutes", { count: s.duration_minutes }),
      ...(s.capacity === null ? [] : [t.count("series.seats", s.capacity)]),
    ].join(" · "),
    coach: t("series.coach", { name: staff.find((person) => person.id === s.coach_id)?.name ?? t("series.formerCoach") }),
    range: rangeLabel(t, s),
  }));
}

/** "8 Nov" for a calendar date: the list is about now, so no year. */
const dayMonth = (isoDate: string, locale: string): string =>
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
