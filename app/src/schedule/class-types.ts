// The rules of the "Class types" screens, kept apart from the screens so they can be tested.
import type { components } from "@/api/schema";
import type { Translator } from "@/i18n/translate";

export type ClassType = components["schemas"]["ClassTypeOut"];
export type Mode = "rsvp" | "booking";
export type ClassTypeForm = { name: string; mode: Mode };

/** The list is fetched with the archived ones; active first-class, archived kept apart (already sorted by name). */
export const splitTypes = (types: ClassType[]) => ({
  active: types.filter((c) => c.archived_at === null),
  archived: types.filter((c) => c.archived_at !== null),
});

export const typeForm = (type: ClassType | undefined): ClassTypeForm => ({
  name: type?.name ?? "",
  mode: type?.attendance_mode === "booking" ? "booking" : "rsvp",
});

/** Booking is offered when the studio has the module, or when the type already is one (so it shows as chosen). */
export const modeChoices = (modules: string[], current: Mode): Mode[] =>
  modules.includes("booking") || current === "booking" ? ["rsvp", "booking"] : ["rsvp"];

/** The body of POST (type undefined) or PUT: the name, and the mode only when it is new or changed. Null = nothing to save. */
export function toBody(form: ClassTypeForm, type: ClassType | undefined) {
  const name = form.name.trim();
  if (name === "") return null;
  const mode = typeForm(type).mode;
  if (!type) return form.mode === "rsvp" ? { name } : { name, attendance_mode: form.mode };
  if (name === type.name && form.mode === mode) return null;
  return form.mode === mode ? { name } : { name, attendance_mode: form.mode };
}

export type TypeOutcome = "ok" | "nameTaken" | "noModule" | "gone" | "notOwner" | "unreachable" | "error";

export function typeOutcome(status: number, detail: unknown): TypeOutcome {
  if (status === 409 && detail === "class_type_name_taken") return "nameTaken";
  if (status === 403 && detail === "module_disabled") return "noModule";
  if (status === 403) return "notOwner";
  if (status === 404) return "gone";
  return "error";
}

/** The message under the Save or Archive button after a try; null when it worked. */
export function typeMessage(t: Translator, outcome: TypeOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "nameTaken":
      return t("classTypes.nameTaken");
    case "noModule":
      return t("classTypes.noModule");
    case "gone":
      return t("classTypes.gone");
    case "notOwner":
      return t("classTypes.notOwner");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
