import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { attendOutcome, type AttendOutcome } from "./attendance";
import {
  addAttendee,
  formFromReport,
  removeAttendee,
  saveOutcome,
  toPayload,
  type Attendee,
  type ReportForm,
  type SaveOutcome,
} from "./report";

type State =
  | { status: "loading" }
  | { status: "ready"; saved: ReportForm; attendees: Attendee[] } // no report yet is an empty form, not an error
  | { status: "notFound" } // no such session in this studio: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

/** The report of one session, for editing, and the call that saves it. */
export function useReport(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      // The report and the people it has notes for are separate calls; the form needs both, and
      // without the attendees it would not know whose notes it is looking at, so either failing
      // is a failure of the whole load.
      const [report, attendees] = await Promise.all([
        api.GET("/sessions/{session_id}/report", { params: { path: { session_id: id } } }),
        api.GET("/sessions/{session_id}/attendees", { params: { path: { session_id: id } } }),
      ]);
      if (!attendees.data) {
        setState({ status: attendees.response.status === 404 ? "notFound" : "error" });
        return;
      }
      if (report.data) {
        setState({ status: "ready", saved: formFromReport(report.data), attendees: attendees.data });
        return;
      }
      const detail = (report.error as { detail?: unknown } | undefined)?.detail;
      if (report.response.status === 404 && detail === "report_not_found") {
        setState({ status: "ready", saved: formFromReport(null), attendees: attendees.data });
      } else {
        setState({ status: report.response.status === 404 ? "notFound" : "error" });
      }
    } catch {
      setState({ status: "error" });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The whole report is replaced; the server's answer becomes the new saved copy.
  const save = useCallback(
    async (form: ReportForm): Promise<SaveOutcome> => {
      try {
        const { data, error, response } = await api.PUT("/sessions/{session_id}/report", {
          params: { path: { session_id: id } },
          body: toPayload(form),
        });
        if (data) {
          setState((s) => (s.status === "ready" ? { ...s, saved: formFromReport(data) } : s));
          return "ok";
        }
        return saveOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        return "unreachable"; // fetch throws when there is no answer at all
      }
    },
    [id],
  );

  // Marks someone as having come (or not), then updates the list of attendees in place. The report
  // is NOT reloaded: that would throw away what the coach has typed and not saved yet.
  const setAttended = useCallback(
    async (person: Attendee, attended: boolean): Promise<AttendOutcome> => {
      try {
        const { error, response } = await api.POST("/sessions/{session_id}/attendance", {
          params: { path: { session_id: id } },
          body: { attended, participant_id: person.participant_id },
        });
        if (response.ok) {
          setState((s) =>
            s.status === "ready"
              ? {
                  ...s,
                  attendees: attended
                    ? addAttendee(s.attendees, person)
                    : removeAttendee(s.attendees, person.participant_id),
                }
              : s,
          );
          return "ok";
        }
        return attendOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        return "unreachable"; // fetch throws when there is no answer at all
      }
    },
    [id],
  );

  return { ...state, retry: load, save, setAttended };
}
