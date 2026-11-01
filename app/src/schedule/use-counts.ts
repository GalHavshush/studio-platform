import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";

export type Counts = { going: number; maybe: number; waitlist: number };

/**
 * How many said going, maybe and waiting for each of these classes (staff only: the API gives a
 * member no counts). One request per class; a class that fails just has no entry.
 * ponytail: a coach has a few classes a day, so there is no batching; add an API list if that grows.
 */
export function useCounts(ids: string[]) {
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [tick, setTick] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    let current = true;
    for (const id of key ? key.split(",") : []) {
      api
        .GET("/sessions/{session_id}", { params: { path: { session_id: id } } })
        .then(({ data }) => {
          const c = data?.rsvp_counts;
          if (current && c) setCounts((all) => ({ ...all, [id]: { going: c.going, maybe: c.maybe, waitlist: c.waitlist } }));
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [key, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { counts, refresh };
}
