import { makeTranslator } from "@/i18n/translate";

import { confirmation, outcomeMessage, planLabel, seatsText, selectedChoice } from "./plan";

const t = makeTranslator("en");

test("each plan has its own words, and no plan reads as not answered", () => {
  expect(planLabel(t, "going")).toBe("Going");
  expect(planLabel(t, "maybe")).toBe("Maybe");
  expect(planLabel(t, "not_going")).toBe("Not going");
  expect(planLabel(t, "waitlist")).toBe("On the waiting list");
  expect(planLabel(t, null)).toBe("not answered");
});

test("a button is highlighted for each plan, and a waitlisted person has Going highlighted", () => {
  expect(selectedChoice("going")).toBe("going");
  expect(selectedChoice("maybe")).toBe("maybe");
  expect(selectedChoice("not_going")).toBe("not_going");
  expect(selectedChoice("waitlist")).toBe("going");
  expect(selectedChoice(null)).toBeNull();
});

test("seats are counted out loud, with one seat in the singular", () => {
  expect(seatsText(t, 5, null)).toBe("5 seats left");
  expect(seatsText(t, 1, null)).toBe("1 seat left");
});

test("a full class says what going will do for this person", () => {
  expect(seatsText(t, 0, null)).toBe("Full: going puts you on the waiting list");
  expect(seatsText(t, 0, "maybe")).toBe("Full: going puts you on the waiting list");
  expect(seatsText(t, 0, "going")).toBe("Full, and you have a seat");
  expect(seatsText(t, 0, "waitlist")).toBe("Full, you're on the waiting list");
});

test("a class without seats says nothing about seats", () => {
  expect(seatsText(t, null, "going")).toBeNull();
});

test("going with seats left asks to book one", () => {
  expect(confirmation(t, "going", null, 3)).toEqual({
    title: "Book a seat?",
    message: "3 seats left.",
    confirm: "Book",
  });
  expect(confirmation(t, "going", "maybe", 1).message).toBe("1 seat left.");
});

test("going on a full class asks to join the waiting list", () => {
  expect(confirmation(t, "going", null, 0)).toEqual({
    title: "Join the waiting list?",
    message: "This class is full. You'll get a seat if one opens.",
    confirm: "Join the waiting list",
  });
});

test("giving up a seat or a place in line says so", () => {
  expect(confirmation(t, "maybe", "going", 2).title).toBe("Give up your seat?");
  expect(confirmation(t, "not_going", "going", 0).title).toBe("Give up your seat?");
  expect(confirmation(t, "maybe", "waitlist", 0).title).toBe("Leave the waiting list?");
  expect(confirmation(t, "not_going", "waitlist", 0).message).toBe("You'll lose your place in line.");
});

test("other changes get a plain question", () => {
  expect(confirmation(t, "maybe", null, 4)).toEqual({
    title: 'Change your plan to "Maybe"?',
    message: "",
    confirm: "Maybe",
  });
  expect(confirmation(t, "not_going", "maybe", 4).confirm).toBe("Not going");
});

test("a booking class with no seat limit never talks about seats", () => {
  expect(confirmation(t, "going", null, null).title).toBe('Change your plan to "Going"?');
  expect(confirmation(t, "maybe", "going", null).title).toBe('Change your plan to "Maybe"?');
});

test("each way an RSVP can fail has its own message, and success has none", () => {
  expect(outcomeMessage(t, "ok")).toBeNull();
  expect(outcomeMessage(t, "cancelled")).toBe("This session was cancelled.");
  expect(outcomeMessage(t, "unreachable")).toBe("Can't reach the server.");
  expect(outcomeMessage(t, "error")).toBe("Something went wrong. Try again.");
});
