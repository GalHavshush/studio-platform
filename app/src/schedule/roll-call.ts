// The class page's roll call for staff: who is coming, and who has been marked as having come.
import type { components } from "@/api/schema";

import type { Attendee } from "./report";

export type RsvpEntry = components["schemas"]["RsvpEntry"];

export type Person = {
  id: string;
  name: string;
  came: boolean;
  position: number | null; // place in line on the waiting list
  walkIn: boolean; // marked as having come without having said going or maybe
};

/**
 * The three lists the page shows. Someone who came without a going, maybe or waiting answer
 * (a walk-in, or someone who had said "not going") is added to the going list, so everyone marked
 * is on the screen. The server sends names in order and the waiting list by queue place; that
 * order is kept.
 */
export function rollCall(rsvps: RsvpEntry[], came: Attendee[]) {
  const cameIds = new Set(came.map((a) => a.participant_id));
  const person = (r: RsvpEntry): Person => ({
    id: r.participant_id,
    name: r.name,
    came: cameIds.has(r.participant_id),
    position: r.waitlist_position,
    walkIn: false,
  });
  const by = (status: string) => rsvps.filter((r) => r.status === status).map(person);
  const listed = new Set(rsvps.filter((r) => ["going", "maybe", "waitlist"].includes(r.status)).map((r) => r.participant_id));
  const walkIns = came
    .filter((a) => !listed.has(a.participant_id))
    .map((a): Person => ({ id: a.participant_id, name: a.name, came: true, position: null, walkIn: true }));
  return { going: [...by("going"), ...walkIns], maybe: by("maybe"), waiting: by("waitlist") };
}

export const markedCount = (people: Person[]) => people.filter((p) => p.came).length;
