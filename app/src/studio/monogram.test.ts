import { monogram } from "./monogram";

test("two words give their first letters", () => {
  expect(monogram("Pilot Studio")).toBe("PS");
  expect(monogram("  iron   yard  gym ")).toBe("IY");
});

test("one word gives its first two letters", () => {
  expect(monogram("Flow")).toBe("FL");
  expect(monogram("X")).toBe("X");
});

test("symbols are skipped, and a name with no letters is a question mark", () => {
  expect(monogram("& Co. Fitness")).toBe("CF");
  expect(monogram("???")).toBe("?");
});
