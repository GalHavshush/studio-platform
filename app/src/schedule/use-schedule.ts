import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

import { addDays, startOfDay } from "./time";

export type ScheduledSession = components["schemas"]["SessionOut"];

const WINDOW_DAYS = 14;

type State = {
  status: "loading" | "ready" | "error";
  sessions: ScheduledSession[]; // earliest first
  classTypeNames: Record<string, string>;
  from: number; // the window shown is [from, to), as instants
  to: number;
  busy: "refresh" | "earlier" | "later" | null;
  error: boolean; // the last load failed (the screen keeps whatever it already has)
};

function empty(timezone: string): State {
  const from = startOfDay(Date.now(), timezone);
  return {
    status: "loading",
    sessions: [],
    classTypeNames: {},
    from,
    to: addDays(from, WINDOW_DAYS, timezone),
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
 * The studio's sessions in a window that starts at the beginning of today and can grow in either
 * direction, 14 days at a time. `refresh` goes back to the starting window.
 */
export function useSchedule(timezone: string) {
  const [state, setState] = useState<State>(() => empty(timezone));
  const latest = useRef(state);
  latest.current = state;
  const busy = useRef(false); // taps while a load is running are ignored

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const first = latest.current.status === "loading";
    if (!first) setState((s) => ({ ...s, busy: "refresh" }));
    const from = startOfDay(Date.now(), timezone);
    const to = addDays(from, WINDOW_DAYS, timezone);
    const [sessions, classTypeNames] = await Promise.all([
      fetchSessions(from, to),
      fetchClassTypeNames(),
    ]);
    busy.current = false;
    setState((s) =>
      sessions && classTypeNames
        ? { status: "ready", sessions, classTypeNames, from, to, busy: null, error: false }
        : { ...s, status: s.status === "loading" ? "error" : s.status, busy: null, error: true },
    );
  }, [timezone]);

  const extend = useCallback(
    async (direction: "earlier" | "later") => {
      if (busy.current) return;
      busy.current = true;
      setState((s) => ({ ...s, busy: direction }));
      const { from, to } = latest.current;
      const [newFrom, newTo] =
        direction === "earlier"
          ? [addDays(from, -WINDOW_DAYS, timezone), from]
          : [to, addDays(to, WINDOW_DAYS, timezone)];
      const more = await fetchSessions(newFrom, newTo);
      busy.current = false;
      setState((s) =>
        more
          ? {
              ...s,
              sessions: merge(s.sessions, more),
              from: direction === "earlier" ? newFrom : s.from,
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

  return {
    ...state,
    refresh,
    showEarlier: () => extend("earlier"),
    showLater: () => extend("later"),
  };
}
