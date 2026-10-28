import { confirmation, outcomeMessage, planLabel, seatsText, selectedChoice } from "./plan";

test("each plan has its own words, and no plan reads as not answered", () => {
  expect(planLabel("going")).toBe("Going");
  expect(planLabel("maybe")).toBe("Maybe");
  expect(planLabel("not_going")).toBe("Not going");
  expect(planLabel("waitlist")).toBe("On the waiting list");
  expect(planLabel(null)).toBe("not answered");
});

test("a button is highlighted for each plan, and a waitlisted person has Going highlighted", () => {
  expect(selectedChoice("going")).toBe("going");
  expect(selectedChoice("maybe")).toBe("maybe");
  expect(selectedChoice("not_going")).toBe("not_going");
  expect(selectedChoice("waitlist")).toBe("going");
  expect(selectedChoice(null)).toBeNull();
});

test("seats are counted out loud, with one seat in the singular", () => {
  expect(seatsText(5, null)).toBe("5 seats left");
  expect(seatsText(1, null)).toBe("1 seat left");
});

test("a full class says what going will do for this person", () => {
  expect(seatsText(0, null)).toBe("Full: going puts you on the waiting list");
  expect(seatsText(0, "maybe")).toBe("Full: going puts you on the waiting list");
  expect(seatsText(0, "going")).toBe("Full, and you have a seat");
  expect(seatsText(0, "waitlist")).toBe("Full, you're on the waiting list");
});

test("a class without seats says nothing about seats", () => {
  expect(seatsText(null, "going")).toBeNull();
});

test("going with seats left asks to book one", () => {
  expect(confirmation("going", null, 3)).toEqual({
    title: "Book a seat?",
    message: "3 seats left.",
    confirm: "Book",
  });
  expect(confirmation("going", "maybe", 1).message).toBe("1 seat left.");
});

test("going on a full class asks to join the waiting list", () => {
  expect(confirmation("going", null, 0)).toEqual({
    title: "Join the waiting list?",
    message: "This class is full. You'll get a seat if one opens.",
    confirm: "Join the waiting list",
  });
});

test("giving up a seat or a place in line says so", () => {
  expect(confirmation("maybe", "going", 2).title).toBe("Give up your seat?");
  expect(confirmation("not_going", "going", 0).title).toBe("Give up your seat?");
  expect(confirmation("maybe", "waitlist", 0).title).toBe("Leave the waiting list?");
  expect(confirmation("not_going", "waitlist", 0).message).toBe("You'll lose your place in line.");
});

test("other changes get a plain question", () => {
  expect(confirmation("maybe", null, 4)).toEqual({
    title: 'Change your plan to "Maybe"?',
    message: "",
    confirm: "Maybe",
  });
  expect(confirmation("not_going", "maybe", 4).confirm).toBe("Not going");
});

test("a booking class with no seat limit never talks about seats", () => {
  expect(confirmation("going", null, null).title).toBe('Change your plan to "Going"?');
  expect(confirmation("maybe", "going", null).title).toBe('Change your plan to "Maybe"?');
});

test("each way an RSVP can fail has its own message, and success has none", () => {
  expect(outcomeMessage("ok")).toBeNull();
  expect(outcomeMessage("cancelled")).toBe("This session was cancelled.");
  expect(outcomeMessage("unreachable")).toBe("Can't reach the server.");
  expect(outcomeMessage("error")).toBe("Something went wrong. Try again.");
});
