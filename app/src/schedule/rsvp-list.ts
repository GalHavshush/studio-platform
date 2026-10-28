// Turns the staff list of who is coming into the four groups the screen shows.
import type { components } from "@/api/schema";

export type RsvpEntry = components["schemas"]["RsvpEntry"];

export type GroupKey = "going" | "waitlist" | "maybe" | "not_going";
export type RsvpGroup = { key: GroupKey; title: string; entries: RsvpEntry[] };

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: "going", title: "Going" },
  { key: "waitlist", title: "Waiting list" },
  { key: "maybe", title: "Maybe" },
  { key: "not_going", title: "Not going" },
];

/**
 * The groups in a fixed order, each with its people in the order the server sent them (it already
 * sorts by name, and the waiting list by queue position). A group nobody is in is left out, and so
 * is a status this version of the app does not know, rather than showing it under a wrong heading.
 */
export function groupRsvps(entries: RsvpEntry[]): RsvpGroup[] {
  return GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => e.status === g.key) })).filter(
    (g) => g.entries.length > 0,
  );
}
