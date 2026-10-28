// The display rules for a person's RSVP, kept apart from the screen so they can be tested.
// `myRsvp` is the server's word for the caller's plan: going, maybe, not_going, waitlist or null.

export type Choice = "going" | "maybe" | "not_going";

export const CHOICES: { value: Choice; label: string }[] = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "not_going", label: "Not going" },
];

const label = (choice: Choice) => CHOICES.find((c) => c.value === choice)!.label;

export function planLabel(myRsvp: string | null): string {
  if (myRsvp === "waitlist") return "On the waiting list";
  const choice = CHOICES.find((c) => c.value === myRsvp);
  return choice ? choice.label : "not answered";
}

/** The button to highlight. A waitlisted person asked for "going", so that one. */
export function selectedChoice(myRsvp: string | null): Choice | null {
  if (myRsvp === "waitlist") return "going";
  return CHOICES.find((c) => c.value === myRsvp)?.value ?? null;
}

/** What to say about seats; null when the class has no seats to count. */
export function seatsText(seatsLeft: number | null, myRsvp: string | null): string | null {
  if (seatsLeft === null) return null;
  if (seatsLeft > 0) return seatsLeft === 1 ? "1 seat left" : `${seatsLeft} seats left`;
  if (myRsvp === "going") return "Full, and you have a seat";
  if (myRsvp === "waitlist") return "Full, you're on the waiting list";
  return "Full: going puts you on the waiting list";
}

export type Confirmation = { title: string; message: string; confirm: string };

/**
 * What to ask before changing the plan in a booking class: the answer can cost or free a seat, so
 * the question says which. `seatsLeft` is null when the class has no seat limit.
 */
export function confirmation(
  choice: Choice,
  myRsvp: string | null,
  seatsLeft: number | null,
): Confirmation {
  if (choice === "going") {
    if (seatsLeft === 0) {
      return {
        title: "Join the waiting list?",
        message: "This class is full. You'll get a seat if one opens.",
        confirm: "Join the waiting list",
      };
    }
    if (seatsLeft !== null) {
      return {
        title: "Book a seat?",
        message: seatsLeft === 1 ? "1 seat left." : `${seatsLeft} seats left.`,
        confirm: "Book",
      };
    }
  } else if (seatsLeft !== null) {
    if (myRsvp === "going") {
      return { title: "Give up your seat?", message: "You'll give up your seat.", confirm: "Give up" };
    }
    if (myRsvp === "waitlist") {
      return {
        title: "Leave the waiting list?",
        message: "You'll lose your place in line.",
        confirm: "Leave",
      };
    }
  }
  return { title: `Change your plan to "${label(choice)}"?`, message: "", confirm: label(choice) };
}

export type RsvpOutcome = "ok" | "cancelled" | "unreachable" | "error";

/** The message under the buttons after a try; null when it worked. */
export function outcomeMessage(outcome: RsvpOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "cancelled":
      return "This session was cancelled.";
    case "unreachable":
      return "Can't reach the server.";
    case "error":
      return "Something went wrong. Try again.";
  }
}
