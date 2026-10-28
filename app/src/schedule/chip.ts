export type ChipTone = "accent" | "soft" | "primary";

const TONES: ChipTone[] = ["accent", "soft", "primary"];

/**
 * The colour of a class's time chip on the schedule. It comes from the class type's id, so a class
 * keeps its colour every time it appears, and no table of colours has to be kept in step with the
 * studio's class types.
 */
export function chipTone(classTypeId: string): ChipTone {
  let sum = 0;
  for (const ch of classTypeId) sum += ch.charCodeAt(0);
  return TONES[sum % TONES.length];
}
