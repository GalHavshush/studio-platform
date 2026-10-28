import { en } from "./en";
import { DICTIONARIES, makeTranslator } from "./translate";

const t = makeTranslator("en");

test("a key gives its English text", () => {
  expect(t("login.signIn")).toBe("Sign in");
});

test("{holes} are filled from the values given, and an unfilled one is left visible", () => {
  expect(t("studios.cardLabel", { name: "Dojo", role: "Coach" })).toBe("Dojo, Coach");
  expect(t("studios.cardLabel", { name: "Dojo" })).toBe("Dojo, {role}");
});

test("a count picks the singular or plural wording and fills in the number", () => {
  expect(t.count("plan.seatsLeft", 1)).toBe("1 seat left");
  expect(t.count("plan.seatsLeft", 5)).toBe("5 seats left");
  expect(t.count("plan.seatsLeft", 0)).toBe("0 seats left");
});

test("a key a language leaves out falls back to English", () => {
  const partial = makeTranslator("en", { "login.signIn": "Enter" });

  expect(partial("login.signIn")).toBe("Enter");
  expect(partial("login.email")).toBe("Email");
});

test("a plural form a language leaves out falls back to its .other form", () => {
  const partial = makeTranslator("en", { "plan.seatsLeft.other": "{count} places" });

  expect(partial.count("plan.seatsLeft", 5)).toBe("5 places");
});

test("every language has every key, and no key English does not have", () => {
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    expect({ language, missing: Object.keys(en).filter((k) => !(k in dictionary)) }).toEqual({
      language,
      missing: [],
    });
    expect({ language, extra: Object.keys(dictionary).filter((k) => !(k in en)) }).toEqual({
      language,
      extra: [],
    });
  }
});
