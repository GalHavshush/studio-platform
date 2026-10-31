// How full a class is, 0 to 1, for the seat bar. Null when there is no number to show: the class has
// no seat limit, or its seats are not counted (a class that is not a booking class).
export function seatsFilled(capacity: number | null, seatsLeft: number | null): number | null {
  if (capacity === null || seatsLeft === null || capacity <= 0) return null;
  return Math.min(1, Math.max(0, (capacity - seatsLeft) / capacity));
}
