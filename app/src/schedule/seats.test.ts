import { seatsFilled } from "./seats";

test("no bar without a limit or without counted seats", () => {
  expect(seatsFilled(null, 3)).toBeNull();
  expect(seatsFilled(20, null)).toBeNull();
  expect(seatsFilled(0, 0)).toBeNull();
});

test("the bar is the share of seats taken", () => {
  expect(seatsFilled(20, 20)).toBe(0);
  expect(seatsFilled(20, 5)).toBe(0.75);
  expect(seatsFilled(20, 0)).toBe(1);
});

test("a count outside the limit stays between 0 and 1", () => {
  expect(seatsFilled(10, -2)).toBe(1);
  expect(seatsFilled(10, 14)).toBe(0);
});
