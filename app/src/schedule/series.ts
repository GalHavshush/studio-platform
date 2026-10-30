// How a weekly class (a series) is worded in the "Weekly classes" list, kept apart from the screen so it can
// be tested. Every function that words something takes the translator `t` first.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

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
