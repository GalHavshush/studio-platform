// The rules of the weekly-class screen and its edit form, kept apart from the screens so they can be tested:
// the form read back from a series, the only-what-changed body, and what each answer of the API is worded as.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import { clock, type Series, type SeriesSessionRow } from "./series";
import { seatsValue, type NewSessionForm } from "./new-session";
import { dateFormat, startOfDay } from "./time";

export type SeriesPatch = components["schemas"]["SeriesPatch"];
export type SeriesEdited = components["schemas"]["SeriesEditOut"];
export type SeriesEnded = components["schemas"]["SeriesEndOut"];

const two = (n: number) => String(n).padStart(2, "0");

/** The form as the series stands now. The day is not part of the rule's edit (it stays the first date's weekday). */
export function seriesForm(series: Series, now: number, timeZone: string): NewSessionForm {
  const [hour, minute] = clock(series.start_time).split(":").map(Number);
  return {
    classTypeId: series.class_type_id,
    dayStart: startOfDay(now, timeZone),
    hour,
    minute,
    duration: series.duration_minutes,
    seats: series.capacity === null ? "" : String(series.capacity),
    coachId: series.coach_id,
  };
}

/** The body of `PATCH /series/{id}`: only the fields that differ from the series. Empty = nothing to save. */
export function seriesPatch(form: NewSessionForm, series: Series, seatsShown: boolean): SeriesPatch {
  const patch: SeriesPatch = {};
  const start = `${two(form.hour)}:${two(form.minute)}`;
  if (start !== clock(series.start_time)) patch.start_time = start;
  if (form.duration !== series.duration_minutes) patch.duration_minutes = form.duration;
  const seats = seatsShown ? seatsValue(form.seats) : series.capacity;
  if (seats !== "invalid" && seats !== series.capacity) patch.capacity = seats;
  if (form.coachId && form.coachId !== series.coach_id) patch.coach_id = form.coachId;
  return patch;
}

export type ActionOutcome = "ok" | "gone" | "clash" | "badCoach" | "hasHistory" | "notStarted" | "unreachable" | "error";

export function actionOutcome(status: number, detail: unknown): ActionOutcome {
  if (status === 404 && detail === "series_not_found") return "gone";
  if (status === 409 && detail === "session_time_clash") return "clash";
  if (status === 409 && detail === "series_has_history") return "hasHistory";
  if (status === 409 && detail === "series_not_started") return "notStarted";
  if (status === 422 && detail === "invalid_coach") return "badCoach";
  return "error";
}

/** The message under the buttons after a failed try; null when it worked. */
export function failureMessage(t: Translator, outcome: ActionOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "gone":
      return t("seriesScreen.gone");
    case "clash":
      return t("seriesScreen.clash");
    case "hasHistory":
      return t("seriesScreen.hasHistory");
    case "notStarted":
      return t("seriesScreen.notStarted");
    case "badCoach":
      return t("editSession.badCoach");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}

export const extendedMessage = (t: Translator, created: number): string =>
  created === 0 ? t("seriesScreen.extendedNone") : t.count("seriesScreen.extended", created);

export const endedMessage = (t: Translator, ended: Pick<SeriesEnded, "sessions_deleted" | "sessions_cancelled">): string =>
  t("seriesScreen.ended", { deleted: ended.sessions_deleted, cancelled: ended.sessions_cancelled });

export const editedMessage = (t: Translator, edited: Pick<SeriesEdited, "sessions_updated" | "sessions_kept">): string =>
  t("seriesScreen.edited", { updated: edited.sessions_updated, kept: edited.sessions_kept });

export type Changes = { count: number; text: string };

const joined = (t: Translator, parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} ${t("seriesScreen.and")} ${parts.at(-1)}`;

/**
 * The "What changes" box: what saving does to the coming classes. Those that are scheduled and were not
 * changed by hand follow the rule (the same test as the API's edit); the ones changed by hand stay. Null when
 * nothing is edited.
 */
export function whatChanges(
  t: Translator,
  patch: SeriesPatch,
  staff: { id: string; name: string }[],
  sessions: SeriesSessionRow[],
  timeZone: string,
): Changes | null {
  const parts: string[] = [];
  if (patch.start_time) parts.push(t("seriesScreen.willStart", { time: patch.start_time }));
  if (patch.duration_minutes) parts.push(t("seriesScreen.willLength", { count: patch.duration_minutes }));
  if (patch.capacity === null) parts.push(t("seriesScreen.willUnlimited"));
  else if (patch.capacity !== undefined) parts.push(t.count("seriesScreen.willSeats", patch.capacity));
  if (patch.coach_id) parts.push(t("seriesScreen.willCoach", { name: staff.find((p) => p.id === patch.coach_id)?.name ?? "?" }));
  if (parts.length === 0) return null;

  const day = (s: SeriesSessionRow) => dateFormat(Date.parse(s.starts_at), timeZone, t.locale);
  const scheduled = sessions.filter((s) => s.status === "scheduled");
  const follow = scheduled.filter((s) => !s.changed_by_hand);
  const stay = scheduled.filter((s) => s.changed_by_hand);
  const head =
    follow.length === 0
      ? t("seriesScreen.followNone")
      : t.count("seriesScreen.follow", follow.length, { day: day(follow[0]), change: joined(t, parts) });
  const stays = stay.length === 0 ? [] : [t.count("seriesScreen.stays", stay.length, { days: stay.map(day).join(", ") })];
  return { count: follow.length, text: [head, ...stays, t("seriesScreen.pastKept")].join(" ") };
}
