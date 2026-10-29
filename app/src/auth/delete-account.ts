// What deleting your own account can end in, kept apart from the screen so it can be tested.
// Every function that words something takes the translator `t` first.
import type { Translator } from "@/i18n/translate";

export type DeleteOutcome =
  | "ok"
  | "wrongPassword"
  | "ownerFirst"
  | "noPassword"
  | "unreachable"
  | "error";

/** What a refused `DELETE /me` is called, from the status and the `detail` code of the error body. */
export function deleteOutcome(status: number, detail: unknown): DeleteOutcome {
  if (status === 403 && detail === "invalid_password") return "wrongPassword";
  if (status === 409 && detail === "transfer_ownership_first") return "ownerFirst";
  if (status === 409 && detail === "reauthentication_unavailable") return "noPassword";
  return "error";
}

/** The message under the password field after a try; null when it worked. */
export function deleteMessage(t: Translator, outcome: DeleteOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "wrongPassword":
      return t("delete.wrongPassword");
    case "ownerFirst":
      return t("delete.ownerFirst");
    case "noPassword":
      return t("delete.noPassword");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
