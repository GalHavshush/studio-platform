import { makeTranslator } from "@/i18n/translate";

import { deleteMessage, deleteOutcome } from "./delete-account";

const t = makeTranslator("en");

test("each refusal of the server has its own outcome", () => {
  expect(deleteOutcome(403, "invalid_password")).toBe("wrongPassword");
  expect(deleteOutcome(409, "transfer_ownership_first")).toBe("ownerFirst");
  expect(deleteOutcome(409, "reauthentication_unavailable")).toBe("noPassword");
});

test("a status or code it does not know is a plain error, never a wrong password", () => {
  expect(deleteOutcome(403, "insufficient_role")).toBe("error");
  expect(deleteOutcome(403, undefined)).toBe("error");
  expect(deleteOutcome(409, "something_else")).toBe("error");
  expect(deleteOutcome(500, "invalid_password")).toBe("error");
  expect(deleteOutcome(401, "invalid_token")).toBe("error");
});

test("a success has no message and every failure has its own", () => {
  expect(deleteMessage(t, "ok")).toBeNull();

  const failures = ["wrongPassword", "ownerFirst", "noPassword", "unreachable", "error"] as const;
  const messages = failures.map((o) => deleteMessage(t, o));

  expect(messages.every((m) => m && m.length > 0)).toBe(true);
  expect(new Set(messages).size).toBe(failures.length);
});
