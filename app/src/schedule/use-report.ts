import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { formFromReport, saveOutcome, toPayload, type ReportForm, type SaveOutcome } from "./report";

type State =
  | { status: "loading" }
  | { status: "ready"; saved: ReportForm } // no report yet is an empty form, not an error
  | { status: "notFound" } // no such session in this studio: trying again will not help
  | { status: "error" }; // no answer, or a server error: trying again may help

/** The report of one session, for editing, and the call that saves it. */
export function useReport(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { data, error, response } = await api.GET("/sessions/{session_id}/report", {
        params: { path: { session_id: id } },
      });
      if (data) return setState({ status: "ready", saved: formFromReport(data) });
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      if (response.status === 404 && detail === "report_not_found") {
        setState({ status: "ready", saved: formFromReport(null) });
      } else {
        setState({ status: response.status === 404 ? "notFound" : "error" });
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
          setState({ status: "ready", saved: formFromReport(data) });
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
