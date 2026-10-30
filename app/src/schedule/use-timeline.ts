import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { api } from "@/api/client";

import { mergePages, type TimelineEntry } from "./timeline";

type State =
  | { status: "loading" }
  // next: the cursor of the following page, null on the last one; more: a "Show earlier" is running
  | { status: "ready"; items: TimelineEntry[]; next: string | null; more: "idle" | "busy" | "failed" }
  | { status: "notFound" } // no such participant for this caller: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

async function fetchPage(participantId: string, cursor?: string) {
  const { data, response } = await api.GET("/participants/{participant_id}/timeline", {
    params: { path: { participant_id: participantId }, query: cursor ? { cursor } : {} },
  });
  const page = data ? { items: data.items as TimelineEntry[], next: data.next_cursor } : null;
  return { page, status: response.status };
}

/** One person's timeline, a page at a time. The server decides what the caller may see. */
export function useTimeline(participantId: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  // Loads the first page, and again whenever the screen is shown: the tab stays mounted while a report
  // is written elsewhere. A reload keeps what is on screen until the answer comes, and keeps it if it
  // fails; pages added with "Show earlier" are dropped, the newest page is what counts.
  const refresh = useCallback(async () => {
    try {
      const { page, status } = await fetchPage(participantId);
      setState((s) =>
        page
          ? { status: "ready", items: page.items, next: page.next, more: "idle" }
          : s.status === "ready"
            ? s
            : { status: status === 404 ? "notFound" : "error" },
      );
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, [participantId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function showMore() {
    if (state.status !== "ready" || state.next === null || state.more === "busy") return;
    const { items, next } = state;
    setState({ status: "ready", items, next, more: "busy" });
    try {
      const { page } = await fetchPage(participantId, next);
      setState(
        page
          ? { status: "ready", items: mergePages(items, page.items), next: page.next, more: "idle" }
          : { status: "ready", items, next, more: "failed" },
      );
    } catch {
      setState({ status: "ready", items, next, more: "failed" });
    }
  }

  const retry = () => {
    setState({ status: "loading" });
    refresh();
  };

  return { ...state, retry, showMore };
}
