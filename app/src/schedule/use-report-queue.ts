import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { queueWeek, unwrittenFirst, type QueueItem } from "./report-queue";
import type { FirstDay } from "./time";

type State = {
  status: "loading" | "ready" | "error";
  items: QueueItem[];
  weeks: number; // weeks loaded: this one, then one more per "Show earlier"
  more: "idle" | "busy" | "failed";
};

async function fetchWeek(timezone: string, firstDay: FirstDay, weeksBack: number) {
  const { from, to } = queueWeek(Date.now(), timezone, firstDay, weeksBack);
  try {
    const { data } = await api.GET("/report-queue", {
      params: { query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() } },
    });
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * The classes the caller may write a report for, this week and then a week more per `showEarlier`.
 * ponytail: no "that was the last week" signal; the button stays and an empty week shows nothing.
 */
export function useReportQueue(timezone: string, firstDay: FirstDay) {
  const [state, setState] = useState<State>({ status: "loading", items: [], weeks: 1, more: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading", items: [], weeks: 1, more: "idle" });
    const items = await fetchWeek(timezone, firstDay, 0);
    setState(items ? { status: "ready", items, weeks: 1, more: "idle" } : { status: "error", items: [], weeks: 1, more: "idle" });
  }, [timezone, firstDay]);

  useEffect(() => {
    load();
  }, [load]);

  async function showEarlier() {
    if (state.status !== "ready" || state.more === "busy") return;
    setState({ ...state, more: "busy" });
    const older = await fetchWeek(timezone, firstDay, state.weeks);
    setState(
      older
        ? { ...state, items: [...state.items, ...older], weeks: state.weeks + 1, more: "idle" }
        : { ...state, more: "failed" },
    );
  }

  return { status: state.status, items: unwrittenFirst(state.items), more: state.more, retry: load, showEarlier };
}
