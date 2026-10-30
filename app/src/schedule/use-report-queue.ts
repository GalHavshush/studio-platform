import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";

import { queueWeek, unwrittenFirst, type QueueItem } from "./report-queue";
import type { FirstDay } from "./time";

type State = {
  status: "loading" | "ready" | "error";
  items: QueueItem[];
  weeks: number; // weeks loaded: this one, then one more per "Show earlier"
  hasEarlier: boolean; // the API found an older class waiting, before the oldest week loaded
  more: "idle" | "busy" | "failed";
};

async function fetchWeek(timezone: string, firstDay: FirstDay, weeksBack: number) {
  const { from, to } = queueWeek(Date.now(), timezone, firstDay, weeksBack);
  try {
    const { data } = await api.GET("/report-queue", {
      params: { query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() } },
    });
    return data ?? null; // { items, has_earlier }
  } catch {
    return null;
  }
}

/**
 * The classes the caller may write a report for, this week and then a week more per `showEarlier`.
 */
export function useReportQueue(timezone: string, firstDay: FirstDay) {
  const [state, setState] = useState<State>({ status: "loading", items: [], weeks: 1, hasEarlier: false, more: "idle" });

  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  // Loads (or reloads) every week shown so far. A reload keeps what is on screen until the answer
  // arrives, and keeps it if the answer fails.
  const refresh = useCallback(async () => {
    const weeks = latest.current.weeks;
    const pages = await Promise.all(Array.from({ length: weeks }, (_, w) => fetchWeek(timezone, firstDay, w)));
    setState((s) =>
      pages.every((p) => p)
        ? {
            status: "ready",
            items: pages.flatMap((p) => p?.items ?? []),
            weeks,
            hasEarlier: pages[weeks - 1]?.has_earlier ?? false,
            more: "idle",
          }
        : s.status === "loading"
          ? { ...s, status: "error" }
          : s,
    );
  }, [timezone, firstDay]);

  // The tab stays mounted while a report is written on top of it, so it reloads whenever it is shown again.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const retry = () => {
    setState({ status: "loading", items: [], weeks: 1, hasEarlier: false, more: "idle" });
    refresh();
  };

  async function showEarlier() {
    if (state.status !== "ready" || state.more === "busy") return;
    setState({ ...state, more: "busy" });
    const older = await fetchWeek(timezone, firstDay, state.weeks);
    setState(
      older
        ? {
            ...state,
            items: [...state.items, ...older.items],
            weeks: state.weeks + 1,
            hasEarlier: older.has_earlier,
            more: "idle",
          }
        : { ...state, more: "failed" },
    );
  }

  return {
    status: state.status,
    items: unwrittenFirst(state.items),
    hasEarlier: state.hasEarlier,
    more: state.more,
    retry,
    showEarlier,
  };
}
