import { parsePreference } from "./preference";

jest.mock("expo-secure-store", () => ({}));

test.each(["system", "light", "dark"])("a saved %s is kept", (value) => {
  expect(parsePreference(value)).toBe(value);
});

test("nothing saved means System", () => {
  expect(parsePreference(null)).toBe("system");
});

test("an unknown stored value means System", () => {
  expect(parsePreference("sepia")).toBe("system");
});
