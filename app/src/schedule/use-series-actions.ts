import { useCallback } from "react";

import { api } from "@/api/client";

import { actionOutcome, type ActionOutcome, type SeriesEdited, type SeriesEnded, type SeriesPatch } from "./series-actions";

type Answer = { error?: unknown; response: Response };

/** One call to the API, as an outcome: the server judges, the screen words the answer. */
async function run<T>(call: () => Promise<Answer & { data?: T }>): Promise<{ outcome: ActionOutcome; data?: T }> {
  try {
    const { data, error, response } = await call();
    if (response.ok) return { outcome: "ok", data };
    return { outcome: actionOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail) };
  } catch {
    return { outcome: "unreachable" }; // fetch throws when there is no answer at all
  }
}

/** What an owner can do to one weekly class: change it, add weeks, end it, delete it. */
export function useSeriesActions(id: string) {
  return {
    edit: useCallback(
      (body: SeriesPatch) => run<SeriesEdited>(() => api.PATCH("/series/{series_id}", { params: { path: { series_id: id } }, body })),
      [id],
    ),
    extend: useCallback(
      () => run<{ created: number }>(() => api.POST("/series/{series_id}/extend", { params: { path: { series_id: id } } })),
      [id],
    ),
    end: useCallback(
      () => run<SeriesEnded>(() => api.POST("/series/{series_id}/end", { params: { path: { series_id: id } } })),
      [id],
    ),
    remove: useCallback(
      () => run<never>(() => api.DELETE("/series/{series_id}", { params: { path: { series_id: id } } })),
      [id],
    ),
  };
}
