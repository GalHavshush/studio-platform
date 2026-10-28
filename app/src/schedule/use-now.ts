import { useEffect, useState } from "react";

/** The current time in milliseconds, refreshed every `intervalMs`, so a screen that depends on the
 * clock (a window that opens while it is open) re-renders by itself. Stops when the screen closes. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
