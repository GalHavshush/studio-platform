import { useCallback, useState } from "react";

import { api } from "@/api/client";

import { groupRsvps, type RsvpGroup } from "./rsvp-list";

type State =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "ready"; groups: RsvpGroup[] }
  | { status: "error" };

/**
 * Who is coming to one session, for staff. Nothing is fetched until `toggle` opens it, so a
 * session that is only looked at costs no extra request. `reload` refreshes an open list quietly
 * (the names stay on screen meanwhile and stay if the refresh fails); a closed one is left alone.
 */
export function useRsvpList(sessionId: string) {
  const [state, setState] = useState<State>({ status: "closed" });

  const fetchGroups = useCallback(async (): Promise<RsvpGroup[] | null> => {
    try {
      const { data } = await api.GET("/sessions/{session_id}/rsvps", {
        params: { path: { session_id: sessionId } },
      });
      return data ? groupRsvps(data) : null;
    } catch {
      return null; // fetch throws when there is no answer at all
    }
  }, [sessionId]);

  const open = useCallback(async () => {
    setState({ status: "loading" });
    const groups = await fetchGroups();
    setState(groups ? { status: "ready", groups } : { status: "error" });
  }, [fetchGroups]);

  const toggle = useCallback(() => {
    if (state.status === "closed") void open();
    else setState({ status: "closed" });
  }, [state.status, open]);

  const reload = useCallback(async () => {
    if (state.status !== "ready") return;
    const groups = await fetchGroups();
    if (groups) setState((s) => (s.status === "ready" ? { status: "ready", groups } : s));
  }, [state.status, fetchGroups]);

  return { state, toggle, retry: open, reload };
}
