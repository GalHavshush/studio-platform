import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/api/client";

import { typeOutcome, type ClassType, type TypeOutcome } from "./class-types";

type State =
  | { status: "loading" }
  | { status: "ready"; types: ClassType[] }
  | { status: "error" };

async function fetchTypes(): Promise<ClassType[] | null> {
  try {
    const { data } = await api.GET("/class-types", { params: { query: { include_archived: true } } });
    return data ?? null;
  } catch {
    return null;
  }
}

/** Every class type of the studio, archived ones too, and the owner's actions on them. */
export function useClassTypes() {
  const [state, setState] = useState<State>({ status: "loading" });

  // quiet: keep showing the list while it reloads, and keep it if the reload fails
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState({ status: "loading" });
    const data = await fetchTypes();
    if (data) setState({ status: "ready", types: data });
    else if (!quiet) setState({ status: "error" });
  }, []);

  // Coming back from the form shows what is now true; the first focus is the load below.
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (opened.current) void load(true);
    }, [load]),
  );
  useEffect(() => {
    opened.current = true;
    let current = true;
    void fetchTypes().then((data) => current && setState(data ? { status: "ready", types: data } : { status: "error" }));
    return () => {
      current = false;
    };
  }, []);

  // The server judges (the name, the module, the role); the list is refreshed from its answer.
  const act = useCallback(
    async (call: () => Promise<{ error?: unknown; response: Response }>): Promise<TypeOutcome> => {
      try {
        const { error, response } = await call();
        if (response.ok) {
          await load(true);
          return "ok";
        }
        return typeOutcome(response.status, (error as { detail?: unknown } | undefined)?.detail);
      } catch {
        return "unreachable";
      }
    },
    [load],
  );
  const path = (id: string) => ({ params: { path: { class_type_id: id } } });

  return {
    ...state,
    retry: () => load(),
    create: (body: { name: string; attendance_mode?: "rsvp" | "booking" }) => act(() => api.POST("/class-types", { body })),
    update: (id: string, body: { name: string; attendance_mode?: "rsvp" | "booking" }) =>
      act(() => api.PUT("/class-types/{class_type_id}", { ...path(id), body })),
    archive: (id: string) => act(() => api.POST("/class-types/{class_type_id}/archive", path(id))),
    unarchive: (id: string) => act(() => api.POST("/class-types/{class_type_id}/unarchive", path(id))),
  };
}
