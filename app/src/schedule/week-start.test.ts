jest.mock("expo-secure-store", () => ({}));

import { firstDayOf, parseMondayStart } from "./week-start";

test("a saved Monday and a saved Sunday are kept", () => {
  expect(parseMondayStart("monday")).toBe(true);
  expect(parseMondayStart("sunday")).toBe(false);
});

test("nothing saved means the week starts on Monday", () => {
  expect(parseMondayStart(null)).toBe(true);
});

test("an unknown stored value means Monday", () => {
  expect(parseMondayStart("saturday")).toBe(true);
});

test("Monday is day 1 and Sunday is day 0, like JavaScript's weekdays", () => {
  expect(firstDayOf(true)).toBe(1);
  expect(firstDayOf(false)).toBe(0);
});
