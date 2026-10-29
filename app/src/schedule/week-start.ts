import * as SecureStore from "expo-secure-store";

import type { FirstDay } from "./time";

/** Nothing saved, or anything but "sunday", means the week starts on Monday. */
export function parseMondayStart(raw: string | null): boolean {
  return raw !== "sunday";
}

/** The day number the week logic uses: 1 for Monday, 0 for Sunday. */
export const firstDayOf = (mondayStart: boolean): FirstDay => (mondayStart ? 1 : 0);

// A choice about this phone, not about the studio or the account, so sign-out leaves it alone.
const KEY = "app.weekStart";

export const saveMondayStart = (monday: boolean): Promise<void> =>
  SecureStore.setItemAsync(KEY, monday ? "monday" : "sunday");
export const loadMondayStart = async (): Promise<boolean> =>
  parseMondayStart(await SecureStore.getItemAsync(KEY));
