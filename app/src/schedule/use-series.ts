import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";

import type { Series } from "./series";
import type { ClassTypeChoice } from "./new-session";
import type { StaffMember } from "./use-staff";

type Loaded = { status: "ready"; series: Series[]; types: ClassTypeChoice[]; staff: StaffMember[] };
type State = { status: "loading" } | Loaded | { status: "error" };

/** The three lists, or null if any of them did not load: a card with a missing name would look like a class whose coach left. */
async function fetchAll(): Promise<Loaded | null> {
  try {
    const [series, types, staff] = await Promise.all([
      api.GET("/series"),
      api.GET("/class-types", { params: { query: { include_archived: true } } }),
      api.GET("/staff"),
    ]);
    if (!series.data || !types.data || !staff.data) return null;
    return { status: "ready", series: series.data, types: types.data, staff: staff.data };
  } catch {
    return null;
  }
}

/**
 * The studio's weekly classes with the lists that turn their ids into names (class types, archived
 * ones too, and the people who can teach). Owner only, like the three routes behind it.
 * The state starts as "loading", so the first load never sets state inside the effect itself.
 */
export function useSeries() {
  const [state, setState] = useState<State>({ status: "loading" });

  // Every state change happens after the request answers, or in an event handler (retry).
  useEffect(() => {
    let current = true;
    void fetchAll().then((next) => current && setState(next ?? { status: "error" }));
    return () => {
      current = false;
    };
  }, []);

  // Coming back from another screen shows what is now true, quietly: a failed reload keeps the list.
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!opened.current) {
        opened.current = true; // the first focus is the load above
        return;
      }
      void fetchAll().then((next) => next && setState(next));
    }, []),
  );

  // After an action on this screen: show what is now true, keeping the list if the reload fails.
  const refresh = useCallback(async () => {
    const next = await fetchAll();
    if (next) setState(next);
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void fetchAll().then((next) => setState(next ?? { status: "error" }));
  }, []);

  return { ...state, retry, refresh };
}
