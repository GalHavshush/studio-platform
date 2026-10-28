import { chipTone } from "./chip";

const IDS = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

test("a class type always gets the same colour", () => {
  for (const id of IDS) expect(chipTone(id)).toBe(chipTone(id));
});

test("every colour is one of the three", () => {
  for (const id of IDS) expect(["accent", "soft", "primary"]).toContain(chipTone(id));
});

test("the colours are spread over different classes, not all the same", () => {
  expect(new Set(IDS.map(chipTone)).size).toBe(3);
});
