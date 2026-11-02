import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import type { SeriesSessionRow } from "./series";

type State = { status: "loading" } | { status: "ready"; sessions: SeriesSessionRow[] } | { status: "error" };

async function fetchSessions(id: string): Promise<SeriesSessionRow[] | null> {
  try {
    const { data } = await api.GET("/series/{series_id}/sessions", { params: { path: { series_id: id } } });
    return data ?? null;
  } catch {
    return null;
  }
}

/** The weekly class's coming classes with their going counts (the owner's page; the route also lets its coach read). */
export function useSeriesSessions(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  // The state changes after the request answers, never inside the effect itself.
  useEffect(() => {
    let current = true;
    void fetchSessions(id).then((next) => current && setState(next ? { status: "ready", sessions: next } : { status: "error" }));
    return () => {
      current = false;
    };
  }, [id]);

  // After an action on the page: show what is now true, keeping the list if the reload fails.
  const refresh = useCallback(async () => {
    const next = await fetchSessions(id);
    if (next) setState({ status: "ready", sessions: next });
  }, [id]);

  return { ...state, refresh };
}
