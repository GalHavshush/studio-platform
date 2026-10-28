import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

import { attendOutcome, type AttendOutcome } from "./attendance";
import type { Choice, RsvpOutcome } from "./plan";

export type SessionDetail = components["schemas"]["SessionDetail"];

type State =
  | { status: "loading" }
  // stale: the last quiet refresh failed, so what is shown may be a step behind
  | { status: "ready"; session: SessionDetail; stale: boolean }
  | { status: "notFound" } // no such session in this studio: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

/** One session with its names, the caller's own RSVP and (for staff) the RSVP counts. */
export function useSessionDetail(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  // quiet: keep showing the current screen while it loads, and keep it if the load fails
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ status: "loading" });
      try {
        const { data, response } = await api.GET("/sessions/{session_id}", {
          params: { path: { session_id: id } },
        });
        if (data) setState({ status: "ready", session: data, stale: false });
        else if (quiet) setState((s) => (s.status === "ready" ? { ...s, stale: true } : s));
        else setState({ status: response.status === 404 ? "notFound" : "error" });
      } catch {
        if (quiet) setState((s) => (s.status === "ready" ? { ...s, stale: true } : s));
        else setState({ status: "error" });
      }
    },
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

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

  return { ...state, retry: () => load(), rsvp, attend };
}
