import { useEffect, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

import { makeLatest } from "./latest";

export type Hit = components["schemas"]["ParticipantHit"];

type State =
  | { status: "loading" }
  | { status: "ready"; people: Hit[] }
  | { status: "error" };

const next = makeLatest();

/**
 * Searches the studio's participants by name as the text changes (empty text lists the first
 * names). A request per change, no waiting: an answer that arrives after a newer request was
 * started is dropped, so a slow old search can never replace a newer one.
 */
export function useParticipantSearch() {
  const [text, setText] = useState("");
  const [tries, setTries] = useState(0); // "Try again" runs the same search once more
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const isLatest = next();
    (async () => {
      try {
        const { data } = await api.GET("/participants", { params: { query: { q: text, limit: 20 } } });
        if (!isLatest()) return;
        setState(data ? { status: "ready", people: data } : { status: "error" });
      } catch {
        if (isLatest()) setState({ status: "error" });
      }
    })();
  }, [text, tries]);

  return { text, setText, state, retry: () => setTries((n) => n + 1) };
}
