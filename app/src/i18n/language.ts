import * as SecureStore from "expo-secure-store";

import { LANGUAGES, type Language } from "./translate";

// The phone's language, or one picked here.
export type LanguageChoice = "system" | Language;

/** Anything stored that is not a language we have (nothing saved, an old value) means System. */
export function parseChoice(raw: string | null): LanguageChoice {
  return LANGUAGES.find((l) => l.value === raw)?.value ?? "system";
}

/** The language to show: the pick, or the first of the phone's languages we have, else English. */
export function resolveLanguage(choice: LanguageChoice, phoneLanguages: (string | null)[]): Language {
  if (choice !== "system") return choice;
  return LANGUAGES.find((l) => phoneLanguages.includes(l.value))?.value ?? "en";
}

// A choice about this phone, not about the account, so sign-out leaves it alone.
const KEY = "app.language";

export const saveChoice = (c: LanguageChoice): Promise<void> => SecureStore.setItemAsync(KEY, c);
export const loadChoice = async (): Promise<LanguageChoice> => parseChoice(await SecureStore.getItemAsync(KEY));
