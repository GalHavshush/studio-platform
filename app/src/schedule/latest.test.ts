import { makeLatest } from "./latest";

test("only the newest request is current, so a late answer to an older one can be dropped", () => {
  const next = makeLatest();
  const first = next();
  const second = next();

  expect(first()).toBe(false);
  expect(second()).toBe(true);

  const third = next();
  expect(second()).toBe(false);
  expect(third()).toBe(true);
});

test("a request with no newer one stays current however often it is asked", () => {
  const next = makeLatest();
  const only = next();

  expect(only()).toBe(true);
  expect(only()).toBe(true);
});
