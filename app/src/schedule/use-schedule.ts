import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

import { addDays, startOfDay, startOfWeek, type FirstDay } from "./time";

export type ScheduledSession = components["schemas"]["SessionOut"];

const WEEK_DAYS = 7;

type State = {
  status: "loading" | "ready" | "error";
  sessions: ScheduledSession[]; // earliest first
  classTypeNames: Record<string, string>;
  from: number; // the window loaded is [from, to), as instants: whole weeks, Monday to Monday
  to: number;
  shownFrom: number; // sessions before this instant are loaded but kept out of the list
  busy: "refresh" | "earlier" | "later" | null;
  error: boolean; // the last load failed (the screen keeps whatever it already has)
};

function empty(timezone: string, firstDay: FirstDay): State {
  const from = startOfWeek(Date.now(), timezone, firstDay);
  return {
    status: "loading",
    sessions: [],
    classTypeNames: {},
    from,
    to: addDays(from, WEEK_DAYS, timezone),
    shownFrom: startOfDay(Date.now(), timezone),
    busy: null,
    error: false,
  };
}

async function fetchSessions(from: number, to: number): Promise<ScheduledSession[] | null> {
  try {
    const { data } = await api.GET("/sessions", {
      params: { query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() } },
    });
    return data ?? null;
  } catch {
    return null;
  }
}

// Archived class types too: an old session may belong to one that has since been archived.
async function fetchClassTypeNames(): Promise<Record<string, string> | null> {
  try {
    const { data } = await api.GET("/class-types", {
      params: { query: { include_archived: true } },
    });
    return data ? Object.fromEntries(data.map((c) => [c.id, c.name])) : null;
  } catch {
    return null;
  }
}

function merge(a: ScheduledSession[], b: ScheduledSession[]): ScheduledSession[] {
  const byId = new Map([...a, ...b].map((s) => [s.id, s]));
  return [...byId.values()].sort(
    (x, y) => x.starts_at.localeCompare(y.starts_at) || x.id.localeCompare(y.id),
  );
}

/**
 * The studio's sessions for the week we are in (seven days from `firstDay`, studio timezone), growing a week
 * at a time in either direction. The list starts at today: the earlier days of this week are loaded
 * but hidden until "earlier" is used. `sessions` is what the list shows, `all` is everything loaded
 * (the week strip marks the days that have classes). `refresh` goes back to the starting window,
 * and runs again by itself when the first day of the week changes.
 */
export function useSchedule(timezone: string, firstDay: FirstDay) {
  const [state, setState] = useState<State>(() => empty(timezone, firstDay));
  const latest = useRef(state);
  latest.current = state;
  const busy = useRef(false); // taps while a load is running are ignored

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const first = latest.current.status === "loading";
    if (!first) setState((s) => ({ ...s, busy: "refresh" }));
    const from = startOfWeek(Date.now(), timezone, firstDay);
    const to = addDays(from, WEEK_DAYS, timezone);
    const shownFrom = startOfDay(Date.now(), timezone);
    const [sessions, classTypeNames] = await Promise.all([
      fetchSessions(from, to),
      fetchClassTypeNames(),
    ]);
    busy.current = false;
    setState((s) =>
      sessions && classTypeNames
        ? { status: "ready", sessions, classTypeNames, from, to, shownFrom, busy: null, error: false }
        : { ...s, status: s.status === "loading" ? "error" : s.status, busy: null, error: true },
    );
  }, [timezone, firstDay]);

  const extend = useCallback(
    async (direction: "earlier" | "later") => {
      if (busy.current) return;
      const { from, to, shownFrom } = latest.current;
      // The days of this week before today are already loaded: the first "earlier" only shows them.
      if (direction === "earlier" && shownFrom > from) {
        setState((s) => ({ ...s, shownFrom: from }));
        return;
      }
      busy.current = true;
      setState((s) => ({ ...s, busy: direction }));
      const [newFrom, newTo] =
        direction === "earlier"
          ? [addDays(from, -WEEK_DAYS, timezone), from]
          : [to, addDays(to, WEEK_DAYS, timezone)];
      const more = await fetchSessions(newFrom, newTo);
      busy.current = false;
      setState((s) =>
        more
          ? {
              ...s,
              sessions: merge(s.sessions, more),
              from: direction === "earlier" ? newFrom : s.from,
              shownFrom: direction === "earlier" ? newFrom : s.shownFrom,
              to: direction === "later" ? newTo : s.to,
              busy: null,
              error: false,
            }
          : { ...s, busy: null, error: true },
      );
    },
    [timezone],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Coming back to the schedule (from creating a class, say) loads the same weeks again, quietly: the
  // window the person has opened stays as it is, and what is on screen stays if the load fails.
  const reload = useCallback(async () => {
    if (busy.current || latest.current.status !== "ready") return;
    const { from, to } = latest.current;
    const [sessions, classTypeNames] = await Promise.all([fetchSessions(from, to), fetchClassTypeNames()]);
    if (sessions && classTypeNames) setState((s) => ({ ...s, sessions, classTypeNames }));
  }, []);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return {
    ...state,
    sessions: state.sessions.filter((s) => Date.parse(s.starts_at) >= state.shownFrom),
    all: state.sessions,
    refresh,
    showEarlier: () => extend("earlier"),
    showLater: () => extend("later"),
  };
}
