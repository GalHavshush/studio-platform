import { useCallback } from "react";

import { api } from "@/api/client";

import { createOutcome, type CreateOutcome, type toSeriesPayload } from "./new-session";

/** The call that creates a weekly class; the class types to pick from come from `useNewSession`. */
export function useNewSeries() {
  const create = useCallback(async (body: ReturnType<typeof toSeriesPayload>): Promise<CreateOutcome> => {
    try {
      const { data, error, response } = await api.POST("/series", { body });
      return data ? "ok" : createOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
    } catch {
      return "unreachable"; // fetch throws when there is no answer at all
    }
  }, []);
  return { create };
}
