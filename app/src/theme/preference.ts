import * as SecureStore from "expo-secure-store";

// Light, dark, or whatever the phone is set to.
export type Preference = "system" | "light" | "dark";

export const PREFERENCES: { value: Preference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Anything stored that is not one of the three (nothing saved, or an old value) means System. */
export function parsePreference(raw: string | null): Preference {
  return PREFERENCES.find((p) => p.value === raw)?.value ?? "system";
}

// A choice about this phone, not about the account, so sign-out leaves it alone.
const KEY = "app.appearance";

export const savePreference = (p: Preference): Promise<void> => SecureStore.setItemAsync(KEY, p);
export const loadPreference = async (): Promise<Preference> =>
  parsePreference(await SecureStore.getItemAsync(KEY));
