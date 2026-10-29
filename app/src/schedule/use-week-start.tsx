import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { FirstDay } from "./time";
import { firstDayOf, loadMondayStart, saveMondayStart } from "./week-start";

type Value = {
  mondayStart: boolean;
  // the same choice as the number the week logic takes: 1 is Monday, 0 is Sunday
  firstDay: FirstDay;
  // false until the saved choice has been read, so the schedule does not open on the wrong week
  loaded: boolean;
  setMondayStart: (monday: boolean) => void;
};

const Context = createContext<Value | null>(null);

export function WeekStartProvider({ children }: { children: ReactNode }) {
  const [mondayStart, setState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadMondayStart()
      .then(setState)
      .finally(() => setLoaded(true));
  }, []);

  const setMondayStart = useCallback((monday: boolean) => {
    setState(monday);
    void saveMondayStart(monday);
  }, []);

  const value = useMemo(
    () => ({ mondayStart, firstDay: firstDayOf(mondayStart), loaded, setMondayStart }),
    [mondayStart, loaded, setMondayStart],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWeekStart(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("useWeekStart needs a WeekStartProvider");
  return value;
}
