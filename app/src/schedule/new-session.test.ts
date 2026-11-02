import { makeTranslator } from "@/i18n/translate";

import {
  canCreate,
  dateFromIso,
  isoFromDate,
  createMessage,
  createOutcome,
  dayChoices,
  formFromLastClass,
  initialForm,
  seatsValue,
  showSeats,
  times,
  toPayload,
  toSeriesPayload,
  untilBeforeStart,
  wrap,
  type ClassTypeChoice,
  type NewSessionForm,
} from "./new-session";

const t = makeTranslator("en");
const ZONE = "Asia/Jerusalem";
// Jerusalem is UTC+2 from Sun 25 Oct 2026 (summer time ended), so this is Thursday 12:20 there
const NOW = Date.parse("2026-10-29T10:20:00Z");

const form = (over: Partial<NewSessionForm> = {}): NewSessionForm => ({
  ...initialForm(NOW, ZONE),
  classTypeId: "ct1",
  ...over,
});

test("the form opens on today at the next full hour, studio time", () => {
  const f = initialForm(NOW, ZONE);
  expect([f.hour, f.minute, f.duration]).toEqual([13, 0, 60]);
  expect(new Date(f.dayStart).toISOString()).toBe("2026-10-28T22:00:00.000Z"); // Thu 29 Oct 00:00 in Jerusalem
  expect(initialForm(Date.parse("2026-10-29T21:30:00Z"), ZONE).hour).toBe(23); // 23:30 there: stays at 23
});

test("there are fourteen days, from today, each the studio's midnight", () => {
  const days = dayChoices(NOW, ZONE);
  expect(days).toHaveLength(14);
  expect(days[0]).toBe(initialForm(NOW, ZONE).dayStart);
  expect(new Set(days).size).toBe(14);
});

test("hours and minutes wrap round the clock face", () => {
  expect(wrap(23, 1, 24)).toBe(0);
  expect(wrap(0, -1, 24)).toBe(23);
  expect(wrap(55, 5, 60)).toBe(0);
  expect(wrap(0, -5, 60)).toBe(55);
});

test("the end is the start plus the length, in studio time not phone time", () => {
  const f = form({ hour: 9, minute: 30, duration: 90 });
  const { start, end } = times(f, ZONE);
  expect(new Date(start).toISOString()).toBe("2026-10-29T07:30:00.000Z");
  expect(new Date(end).toISOString()).toBe("2026-10-29T09:00:00.000Z");
});

test("seats are typed digits above zero; empty means unlimited", () => {
  expect(seatsValue("")).toBeNull();
  expect(seatsValue("  ")).toBeNull();
  expect(seatsValue(" 12 ")).toBe(12);
  expect(["0", "-3", "2.5", "abc", "1e2"].map(seatsValue)).toEqual(Array(5).fill("invalid"));
});

test("seats are offered only for a booking class in a studio with the booking module", () => {
  const type = (attendance_mode: string) => ({ attendance_mode }) as ClassTypeChoice;
  expect(showSeats(type("booking"), ["booking"])).toBe(true);
  expect(showSeats(type("booking"), [])).toBe(false);
  expect(showSeats(type("rsvp"), ["booking"])).toBe(false);
  expect(showSeats(undefined, ["booking"])).toBe(false);
});

test("it can be created with a class type, and bad seats only block when seats are shown", () => {
  expect(canCreate(form({ classTypeId: null }), false)).toBe(false);
  expect(canCreate(form({ seats: "abc" }), true)).toBe(false);
  expect(canCreate(form({ seats: "abc" }), false)).toBe(true);
  expect(canCreate(form({ seats: "10" }), true)).toBe(true);
});

test("the payload has no coach, and seats only when shown and typed", () => {
  const f = form({ hour: 9, minute: 0, duration: 45, seats: "8" });
  expect(toPayload(f, ZONE, true)).toEqual({
    class_type_id: "ct1",
    starts_at: "2026-10-29T07:00:00.000Z",
    ends_at: "2026-10-29T07:45:00.000Z",
    capacity: 8,
  });
  expect(toPayload(f, ZONE, false)).not.toHaveProperty("capacity");
  expect(toPayload({ ...f, seats: "" }, ZONE, true)).not.toHaveProperty("capacity");
  expect(toPayload(f, ZONE, true)).not.toHaveProperty("coach_id");
});

test("a server answer becomes one outcome and one message", () => {
  expect(createOutcome(422, "class_type_archived")).toBe("typeArchived");
  expect(createOutcome(404, "class_type_not_found")).toBe("typeGone");
  expect(createOutcome(403, "not_your_session")).toBe("notYours");
  expect(createOutcome(500, "boom")).toBe("error");
  expect(createMessage(t, "ok")).toBeNull();
  expect(createMessage(t, "typeArchived")).toMatch(/archived/i);
  expect(createMessage(t, "unreachable")).toBe(t("common.cantReach"));
});

test("a coach is sent only when an owner picked one", () => {
  const f = form({});
  expect(toPayload(f, ZONE, true)).not.toHaveProperty("coach_id");
  expect(toPayload({ ...f, coachId: "u2" }, ZONE, true)).toMatchObject({ coach_id: "u2" });
});

test("a weekly class is the chosen day, its weekday, and the studio's clock as typed", () => {
  const f = form({ hour: 9, minute: 5, duration: 45, seats: "8" }); // Thu 29 Oct 2026, Jerusalem
  expect(toSeriesPayload(f, ZONE, true)).toEqual({
    class_type_id: "ct1",
    weekday: 3, // Thursday, counting from Monday = 0
    start_time: "09:05",
    duration_minutes: 45,
    first_date: "2026-10-29",
    capacity: 8,
  });
  expect(toSeriesPayload(f, ZONE, false)).not.toHaveProperty("capacity");
  expect(toSeriesPayload({ ...f, coachId: "u2" }, ZONE, true)).toMatchObject({ coach_id: "u2" });
});

test("a weekly class takes its date from the studio's calendar, not the phone's", () => {
  const sunday = form({ dayStart: Date.parse("2026-10-31T22:00:00Z") }); // Sun 1 Nov 00:00 in Jerusalem
  expect(toSeriesPayload(sunday, ZONE, false)).toMatchObject({ first_date: "2026-11-01", weekday: 6 });
});

const past = (over: Record<string, unknown> = {}) => ({
  class_type_id: "ct1",
  coach_id: "me",
  starts_at: "2026-10-27T06:00:00Z", // 08:00 in Jerusalem
  ends_at: "2026-10-27T07:30:00Z",
  capacity: 12 as number | null,
  status: "scheduled",
  ...over,
});

test("the form starts from the caller's latest started class", () => {
  const sessions = [
    past({ starts_at: "2026-10-26T06:00:00Z", ends_at: "2026-10-26T07:00:00Z", class_type_id: "ct2" }),
    past(),
    past({ starts_at: "2026-10-31T06:00:00Z", ends_at: "2026-10-31T07:00:00Z", class_type_id: "ct2" }), // not started
  ];
  expect(formFromLastClass(sessions, ["ct1", "ct2"], NOW, ZONE, "me")).toEqual({
    classTypeId: "ct1",
    coachId: null,
    hour: 8,
    minute: 0,
    duration: 90,
    seats: "12",
  });
});

test("an owner who does not teach takes the latest class of anyone, with that coach", () => {
  expect(formFromLastClass([past({ coach_id: "cody", capacity: null })], ["ct1"], NOW, ZONE, "owner")).toMatchObject({
    coachId: "cody",
    seats: "",
  });
});

test("the caller's class wins over a later one of someone else", () => {
  const sessions = [past(), past({ coach_id: "cody", starts_at: "2026-10-28T06:00:00Z", ends_at: "2026-10-28T07:00:00Z" })];
  expect(formFromLastClass(sessions, ["ct1"], NOW, ZONE, "me")?.duration).toBe(90);
});

test("cancelled classes and archived class types are skipped; none left means no pre-fill", () => {
  expect(formFromLastClass([past({ status: "cancelled" })], ["ct1"], NOW, ZONE, "me")).toBeNull();
  expect(formFromLastClass([past()], ["ct9"], NOW, ZONE, "me")).toBeNull();
  expect(formFromLastClass([], ["ct1"], NOW, ZONE, "me")).toBeNull();
});

test("a weekly class has an end date only when one is picked", () => {
  const f = form({ classTypeId: "ct1" });
  expect(toSeriesPayload(f, ZONE, false)).not.toHaveProperty("last_date");
  expect(toSeriesPayload(f, ZONE, false, null)).not.toHaveProperty("last_date");
  expect(toSeriesPayload(f, ZONE, false, "2026-12-22")).toMatchObject({ last_date: "2026-12-22" });
});

test("an end date before the first class is caught; the same day or later is fine", () => {
  expect(untilBeforeStart("2026-11-03", "2026-11-02")).toBe(true);
  expect(untilBeforeStart("2026-11-03", "2026-11-03")).toBe(false);
  expect(untilBeforeStart("2026-11-03", "2026-12-22")).toBe(false);
  expect(untilBeforeStart("2026-11-03", null)).toBe(false);
});

test("a calendar date and the picker's Date convert back and forth without moving the day", () => {
  expect(isoFromDate(dateFromIso("2026-12-22"))).toBe("2026-12-22");
  expect(isoFromDate(dateFromIso("2026-01-05"))).toBe("2026-01-05");
  expect(isoFromDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
});
