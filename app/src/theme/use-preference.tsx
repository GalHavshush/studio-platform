import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance } from "react-native";

import { loadPreference, savePreference, type Preference } from "./preference";

type Value = {
  preference: Preference;
  // false until the saved choice has been read, so the app does not flash the wrong colours
  loaded: boolean;
  setPreference: (p: Preference) => void;
};

const Context = createContext<Value | null>(null);

export function PreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setState] = useState<Preference>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPreference()
      .then(setState)
      .finally(() => setLoaded(true));
  }, []);

  // Overriding the colour scheme at this level makes `useColorScheme` (and with it `useTheme`),
  // the keyboard and system pop-ups all follow the choice. "unspecified" hands control back to the phone.
  useEffect(() => {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  }, [preference]);

  const setPreference = useCallback((p: Preference) => {
    setState(p);
    void savePreference(p);
  }, []);

  const value = useMemo(() => ({ preference, loaded, setPreference }), [preference, loaded, setPreference]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreference(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("usePreference needs a PreferenceProvider");
  return value;
}
