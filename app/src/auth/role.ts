import type { Key } from "@/i18n/en";
import type { Translator } from "@/i18n/translate";

const ROLES: Record<string, Key> = { owner: "role.owner", coach: "role.coach", member: "role.member" };

/** A role as a person reads it. A role this version of the app has no word for is shown as sent. */
export const roleLabel = (t: Translator, role: string): string => (ROLES[role] ? t(ROLES[role]) : role);

/** Coaches and owners write class reports. */
export const isStaff = (role: string): boolean => role === "owner" || role === "coach";
