// The display rules for a person's RSVP, kept apart from the screen so they can be tested.
// `myRsvp` is the server's word for the caller's plan: going, maybe, not_going, waitlist or null.
// Every function that words something takes the translator `t` first.
import type { Key } from "@/i18n/en";
import type { Translator } from "@/i18n/translate";

export type Choice = "going" | "maybe" | "not_going";

export const CHOICES: { value: Choice; label: Key }[] = [
  { value: "going", label: "rsvp.going" },
  { value: "maybe", label: "rsvp.maybe" },
  { value: "not_going", label: "rsvp.notGoing" },
];

const label = (t: Translator, choice: Choice) => t(CHOICES.find((c) => c.value === choice)!.label);

export function planLabel(t: Translator, myRsvp: string | null): string {
  if (myRsvp === "waitlist") return t("plan.waitlist");
  const choice = CHOICES.find((c) => c.value === myRsvp);
  return choice ? t(choice.label) : t("plan.notAnswered");
}

/** The button to highlight. A waitlisted person asked for "going", so that one. */
export function selectedChoice(myRsvp: string | null): Choice | null {
  if (myRsvp === "waitlist") return "going";
  return CHOICES.find((c) => c.value === myRsvp)?.value ?? null;
}

/** What to say about seats; null when the class has no seats to count. */
export function seatsText(t: Translator, seatsLeft: number | null, myRsvp: string | null): string | null {
  if (seatsLeft === null) return null;
  if (seatsLeft > 0) return t.count("plan.seatsLeft", seatsLeft);
  if (myRsvp === "going") return t("plan.fullYouHaveSeat");
  if (myRsvp === "waitlist") return t("plan.fullYouWait");
  return t("plan.fullGoingWaits");
}

export type Confirmation = { title: string; message: string; confirm: string };

/**
 * What to ask before changing the plan in a booking class: the answer can cost or free a seat, so
 * the question says which. `seatsLeft` is null when the class has no seat limit.
 */
export function confirmation(
  t: Translator,
  choice: Choice,
  myRsvp: string | null,
  seatsLeft: number | null,
): Confirmation {
  if (choice === "going") {
    if (seatsLeft === 0) {
      return {
        title: t("confirm.join.title"),
        message: t("confirm.join.message"),
        confirm: t("confirm.join.confirm"),
      };
    }
    if (seatsLeft !== null) {
      return {
        title: t("confirm.book.title"),
        message: t.count("confirm.book.message", seatsLeft),
        confirm: t("confirm.book.confirm"),
      };
    }
  } else if (seatsLeft !== null) {
    if (myRsvp === "going") {
      return {
        title: t("confirm.giveUp.title"),
        message: t("confirm.giveUp.message"),
        confirm: t("confirm.giveUp.confirm"),
      };
    }
    if (myRsvp === "waitlist") {
      return {
        title: t("confirm.leave.title"),
        message: t("confirm.leave.message"),
        confirm: t("confirm.leave.confirm"),
      };
    }
  }
  return {
    title: t("confirm.change.title", { choice: label(t, choice) }),
    message: "",
    confirm: label(t, choice),
  };
}

export type RsvpOutcome = "ok" | "cancelled" | "unreachable" | "error";

/** The message under the buttons after a try; null when it worked. */
export function outcomeMessage(t: Translator, outcome: RsvpOutcome): string | null {
  switch (outcome) {
    case "ok":
      return null;
    case "cancelled":
      return t("session.cancelled");
    case "unreachable":
      return t("common.cantReach");
    case "error":
      return t("common.wentWrong");
  }
}
