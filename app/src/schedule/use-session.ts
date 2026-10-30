import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

import { changeOutcome, type ChangeOutcome, type SessionChanges } from "./edit-session";
import { attendOutcome, type AttendOutcome } from "./attendance";
import type { Choice, RsvpOutcome } from "./plan";

export type SessionDetail = components["schemas"]["SessionDetail"];

type State =
  | { status: "loading" }
  // stale: the last quiet refresh failed, so what is shown may be a step behind
  | { status: "ready"; session: SessionDetail; stale: boolean }
  | { status: "notFound" } // no such session in this studio: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

async function fetchSession(id: string): Promise<State> {
  try {
    const { data, response } = await api.GET("/sessions/{session_id}", {
      params: { path: { session_id: id } },
    });
    if (data) return { status: "ready", session: data, stale: false };
    return { status: response.status === 404 ? "notFound" : "error" };
  } catch {
    return { status: "error" };
  }
}

/** One session with its names, the caller's own RSVP and (for staff) the RSVP counts. */
export function useSessionDetail(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  // quiet: keep showing the current screen while it loads, and keep it if the load fails
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ status: "loading" });
      const next = await fetchSession(id);
      if (next.status === "ready" || !quiet) setState(next);
      else setState((s) => (s.status === "ready" ? { ...s, stale: true } : s));
    },
    [id],
  );

  // Coming back to this screen (from editing the class) shows what is now true; the first focus is the load below.
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (opened.current) void load(true);
    }, [load]),
  );
  useEffect(() => {
    opened.current = true;
    let current = true;
    void fetchSession(id).then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, [id]);

  // The server decides the result (a "going" on a full class becomes the waiting list), so the
  // screen is not changed until the answer is in; then it is refreshed to show the real state.
  const rsvp = useCallback(
    async (choice: Choice): Promise<RsvpOutcome> => {
      try {
        const { error, response } = await api.PUT("/sessions/{session_id}/rsvp", {
          params: { path: { session_id: id } },
          body: { status: choice },
        });
        if (response.ok) {
          await load(true);
          return "ok";
        }
        const detail = (error as { detail?: unknown } | undefined)?.detail;
        return response.status === 409 && detail === "session_cancelled" ? "cancelled" : "error";
      } catch {
        return "unreachable"; // fetch throws when there is no answer at all
      }
    },
    [id, load],
  );

  // Like the RSVP: the server judges (the window, a cancelled class), the screen waits for its answer.
  const attend = useCallback(
    async (attended: boolean): Promise<AttendOutcome> => {
      try {
        const { error, response } = await api.POST("/sessions/{session_id}/attendance", {
          params: { path: { session_id: id } },
          body: { attended },
        });
        if (response.ok) {
          await load(true);
          return "ok";
        }
        return attendOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        return "unreachable"; // fetch throws when there is no answer at all
      }
    },
    [id, load],
  );

  // Edit and cancel: the server judges (owner or own class, a cancelled class), the screen waits for its answer.
  const change = useCallback(
    async (call: () => Promise<{ error?: unknown; response: Response }>): Promise<ChangeOutcome> => {
      try {
        const { error, response } = await call();
        if (response.ok) {
          await load(true);
          return "ok";
        }
        return changeOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        return "unreachable";
      }
    },
    [load],
  );
  const edit = useCallback(
    (body: SessionChanges) =>
      change(() => api.PATCH("/sessions/{session_id}", { params: { path: { session_id: id } }, body })),
    [id, change],
  );
  const cancel = useCallback(
    () => change(() => api.POST("/sessions/{session_id}/cancel", { params: { path: { session_id: id } } })),
    [id, change],
  );

  return { ...state, retry: () => load(), rsvp, attend, edit, cancel };
}
