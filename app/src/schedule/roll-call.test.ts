import { markedCount, rollCall, type RsvpEntry } from "./roll-call";

const entry = (id: string, status: string, position: number | null = null): RsvpEntry => ({
  participant_id: id,
  name: id.toUpperCase(),
  status,
  waitlist_position: position,
});

test("people are listed by their answer, and the ones marked as having come are flagged", () => {
  const rsvps = [entry("a", "going"), entry("b", "going"), entry("c", "maybe"), entry("d", "waitlist", 1), entry("e", "not_going")];
  const lists = rollCall(rsvps, [{ participant_id: "b", name: "B" }]);
  expect(lists.going.map((p) => [p.id, p.came])).toEqual([["a", false], ["b", true]]);
  expect(lists.maybe.map((p) => p.id)).toEqual(["c"]);
  expect(lists.waiting.map((p) => [p.id, p.position])).toEqual([["d", 1]]);
});

test("someone who came without going or maybe is added to the going list as a walk-in", () => {
  const lists = rollCall([entry("a", "going"), entry("e", "not_going")], [
    { participant_id: "e", name: "E" },
    { participant_id: "x", name: "X" },
  ]);
  expect(lists.going.map((p) => [p.id, p.walkIn])).toEqual([["a", false], ["e", true], ["x", true]]);
});

test("the marked count counts only those who came", () => {
  const { going } = rollCall([entry("a", "going"), entry("b", "going")], [{ participant_id: "a", name: "A" }]);
  expect(markedCount(going)).toBe(1);
});
