import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { loadChoice, resolveLanguage, saveChoice, type LanguageChoice } from "./language";
import { makeTranslator, type Translator } from "./translate";

type Value = {
  choice: LanguageChoice;
  t: Translator;
  // false until the saved choice has been read, so the first frame is not in the wrong language
  loaded: boolean;
  setChoice: (c: LanguageChoice) => void;
};

const Context = createContext<Value | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [choice, setState] = useState<LanguageChoice>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadChoice()
      .then(setState)
      .finally(() => setLoaded(true));
  }, []);

  const setChoice = useCallback((c: LanguageChoice) => {
    setState(c);
    void saveChoice(c);
  }, []);

  const value = useMemo(() => {
    const language = resolveLanguage(choice, getLocales().map((l) => l.languageCode));
    return { choice, t: makeTranslator(language), loaded, setChoice };
  }, [choice, loaded, setChoice]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("useLanguage needs a LanguageProvider");
  return value;
}

/** The translator for the current language: `const t = useT(); t("login.signIn")`. */
export const useT = (): Translator => useLanguage().t;
