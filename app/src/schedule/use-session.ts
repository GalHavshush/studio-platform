import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

export type SessionDetail = components["schemas"]["SessionDetail"];

type State =
  | { status: "loading" }
  | { status: "ready"; session: SessionDetail }
  | { status: "notFound" } // no such session in this studio: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

/** One session with its names, the caller's own RSVP and (for staff) the RSVP counts. */
export function useSessionDetail(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { data, response } = await api.GET("/sessions/{session_id}", {
        params: { path: { session_id: id } },
      });
      if (data) setState({ status: "ready", session: data });
      else setState({ status: response.status === 404 ? "notFound" : "error" });
    } catch {
      setState({ status: "error" });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}
