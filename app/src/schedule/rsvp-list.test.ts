import { groupRsvps, type RsvpEntry } from "./rsvp-list";

const entry = (name: string, status: string, position: number | null = null): RsvpEntry => ({
  participant_id: `id-${name}`,
  name,
  status,
  waitlist_position: position,
});

test("the groups come in the order going, waiting list, maybe, not going", () => {
  // Deliberately shuffled: the order comes from the helper, not from the input.
  const groups = groupRsvps([
    entry("Eve", "not_going"),
    entry("Dan", "maybe"),
    entry("Bob", "waitlist", 1),
    entry("Cat", "going"),
  ]);

  expect(groups.map((g) => g.key)).toEqual(["going", "waitlist", "maybe", "not_going"]);
  expect(groups.map((g) => g.title)).toEqual(["Going", "Waiting list", "Maybe", "Not going"]);
});

test("an empty group is left out", () => {
  const groups = groupRsvps([entry("Cat", "going"), entry("Eve", "not_going")]);

  expect(groups.map((g) => g.key)).toEqual(["going", "not_going"]);
});

test("nobody answered gives no groups at all", () => {
  expect(groupRsvps([])).toEqual([]);
});

test("people keep the order the server sent inside their group", () => {
  const groups = groupRsvps([entry("Zed", "going"), entry("Amy", "going"), entry("Mia", "going")]);

  expect(groups[0].entries.map((e) => e.name)).toEqual(["Zed", "Amy", "Mia"]);
});

test("waiting-list positions are kept", () => {
  const groups = groupRsvps([entry("Bob", "waitlist", 1), entry("Ann", "waitlist", 2)]);

  expect(groups[0].entries.map((e) => e.waitlist_position)).toEqual([1, 2]);
});

test("a status the app does not know is left out rather than guessed", () => {
  const groups = groupRsvps([entry("Cat", "going"), entry("Odd", "vacation")]);

  expect(groups).toHaveLength(1);
  expect(groups[0].entries.map((e) => e.name)).toEqual(["Cat"]);
});
