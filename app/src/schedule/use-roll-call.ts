import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { attendOutcome, type AttendOutcome } from "./attendance";
import { addAttendee, removeAttendee, type Attendee } from "./report";
import type { RsvpEntry } from "./roll-call";

type State =
  | { status: "loading" }
  | { status: "ready"; rsvps: RsvpEntry[]; came: Attendee[] }
  | { status: "error" };

async function fetchRollCall(id: string): Promise<State> {
  try {
    const path = { params: { path: { session_id: id } } };
    const [rsvps, came] = await Promise.all([
      api.GET("/sessions/{session_id}/rsvps", path),
      api.GET("/sessions/{session_id}/attendees", path),
    ]);
    return rsvps.data && came.data ? { status: "ready", rsvps: rsvps.data, came: came.data } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Who is coming to a session and who has been marked as having come, for staff. `reloadKey`
 * reloads quietly (what is on screen stays, and stays if the reload fails) when the page knows
 * something changed. `mark` shows the tick at once and takes it back if the server refuses.
 */
export function useRollCall(id: string, reloadKey: unknown) {
  const [state, setState] = useState<State>({ status: "loading" });

  const retry = useCallback(async () => {
    setState({ status: "loading" });
    setState(await fetchRollCall(id));
  }, [id]);

  useEffect(() => {
    let current = true;
    void fetchRollCall(id).then((next) => current && setState((s) => (next.status === "ready" || s.status !== "ready" ? next : s)));
    return () => {
      current = false;
    };
  }, [id, reloadKey]);

  const mark = useCallback(
    async (person: Attendee, attended: boolean): Promise<AttendOutcome> => {
      const change = (list: Attendee[]) => (attended ? addAttendee(list, person) : removeAttendee(list, person.participant_id));
      setState((s) => (s.status === "ready" ? { ...s, came: change(s.came) } : s));
      let outcome: AttendOutcome;
      try {
        const { error, response } = await api.POST("/sessions/{session_id}/attendance", {
          params: { path: { session_id: id } },
          body: { attended, participant_id: person.participant_id },
        });
        outcome = response.ok ? "ok" : attendOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        outcome = "unreachable"; // fetch throws when there is no answer at all
      }
      if (outcome !== "ok") {
        const undo = (list: Attendee[]) => (attended ? removeAttendee(list, person.participant_id) : addAttendee(list, person));
        setState((s) => (s.status === "ready" ? { ...s, came: undo(s.came) } : s));
      }
      return outcome;
    },
    [id],
  );

  return { state, retry, mark };
}
