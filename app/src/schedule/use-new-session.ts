import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

import { createOutcome, type ClassTypeChoice, type CreateOutcome, toPayload } from "./new-session";

type State =
  | { status: "loading" }
  | { status: "ready"; types: ClassTypeChoice[] }
  | { status: "error" };

async function fetchTypes(): Promise<State> {
  try {
    const { data } = await api.GET("/class-types");
    return data ? { status: "ready", types: data } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** The class types a new class can be of (archived ones are left out by the API), and the call that creates it. */
export function useNewSession() {
  const [state, setState] = useState<State>({ status: "loading" });

  const retry = useCallback(async () => {
    setState({ status: "loading" });
    setState(await fetchTypes());
  }, []);

  useEffect(() => {
    let current = true;
    void fetchTypes().then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, []);

  const create = useCallback(async (payload: ReturnType<typeof toPayload>): Promise<{ outcome: CreateOutcome; id?: string }> => {
    try {
      const { data, error, response } = await api.POST("/sessions", { body: payload });
      if (data) return { outcome: "ok", id: data.id };
      return { outcome: createOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail) };
    } catch {
      return { outcome: "unreachable" }; // fetch throws when there is no answer at all
    }
  }, []);

  return { ...state, retry, create };
}
