// The rules of the weekly-class screen and its edit form, kept apart from the screens so they can be tested:
// the form read back from a series, the only-what-changed body, and what each answer of the API is worded as.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

import { clock, type Series } from "./series";
import { seatsValue, type NewSessionForm } from "./new-session";
import { startOfDay } from "./time";

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
