import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { formFromReport, saveOutcome, toPayload, type Attendee, type ReportForm, type SaveOutcome } from "./report";

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

  return { ...state, retry: load, save };
}
