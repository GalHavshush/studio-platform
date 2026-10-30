import { parseChoice, resolveLanguage } from "./language";

jest.mock("expo-secure-store", () => ({}));

test("a saved language is kept", () => {
  expect(parseChoice("en")).toBe("en");
  expect(parseChoice("system")).toBe("system");
});

test("nothing saved, or a language the app does not have, means System", () => {
  expect(parseChoice(null)).toBe("system");
  expect(parseChoice("klingon")).toBe("system");
});

test("a picked language wins over the phone", () => {
  expect(resolveLanguage("en", ["fr"])).toBe("en");
});

test("System follows the first phone language the app has, else English", () => {
  expect(resolveLanguage("system", ["en"])).toBe("en");
  expect(resolveLanguage("system", ["fr", "en"])).toBe("en");
  expect(resolveLanguage("system", ["fr"])).toBe("en");
  expect(resolveLanguage("system", [null])).toBe("en");
});
