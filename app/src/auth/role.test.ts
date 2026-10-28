import { makeTranslator } from "@/i18n/translate";

import { roleLabel } from "./role";

const t = makeTranslator("en");

test("each role has its own word", () => {
  expect(roleLabel(t, "owner")).toBe("Owner");
  expect(roleLabel(t, "coach")).toBe("Coach");
  expect(roleLabel(t, "member")).toBe("Member");
});

test("a role the app does not know is shown as the server sent it", () => {
  expect(roleLabel(t, "assistant")).toBe("assistant");
});
