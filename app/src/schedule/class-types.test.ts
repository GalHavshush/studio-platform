import { makeTranslator } from "@/i18n/translate";

import { modeChoices, splitTypes, toBody, typeForm, typeMessage, typeOutcome, type ClassType } from "./class-types";

const t = makeTranslator("en");
const type = (over: Partial<ClassType> = {}): ClassType => ({
  id: "1",
  name: "Yoga",
  attendance_mode: "rsvp",
  archived_at: null,
  ...over,
});

test("archived types are kept apart, order kept", () => {
  const a = type({ id: "a", name: "A" });
  const b = type({ id: "b", name: "B", archived_at: "2026-10-01T00:00:00Z" });
  const c = type({ id: "c", name: "C" });

  expect(splitTypes([a, b, c])).toEqual({ active: [a, c], archived: [b] });
});

test("booking is offered only with the module, or when the type already is one", () => {
  expect(modeChoices([], "rsvp")).toEqual(["rsvp"]);
  expect(modeChoices(["booking"], "rsvp")).toEqual(["rsvp", "booking"]);
  expect(modeChoices([], "booking")).toEqual(["rsvp", "booking"]);
});

test("a new type sends the name, and the mode only when it is not the default", () => {
  expect(toBody({ name: "  Pilates ", mode: "rsvp" }, undefined)).toEqual({ name: "Pilates" });
  expect(toBody({ name: "Pilates", mode: "booking" }, undefined)).toEqual({ name: "Pilates", attendance_mode: "booking" });
  expect(toBody({ name: "   ", mode: "rsvp" }, undefined)).toBeNull();
});

test("an edit sends only what changed, and nothing when nothing did", () => {
  const yoga = type();

  expect(toBody(typeForm(yoga), yoga)).toBeNull();
  expect(toBody({ name: " Yoga ", mode: "rsvp" }, yoga)).toBeNull();
  expect(toBody({ name: "Hot yoga", mode: "rsvp" }, yoga)).toEqual({ name: "Hot yoga" });
  expect(toBody({ name: "Yoga", mode: "booking" }, yoga)).toEqual({ name: "Yoga", attendance_mode: "booking" });
});

test("the API's refusals become outcomes with a message", () => {
  expect(typeOutcome(409, "class_type_name_taken")).toBe("nameTaken");
  expect(typeOutcome(403, "module_disabled")).toBe("noModule");
  expect(typeOutcome(403, "insufficient_role")).toBe("notOwner");
  expect(typeOutcome(404, "class_type_not_found")).toBe("gone");
  expect(typeOutcome(500, undefined)).toBe("error");
  expect(typeMessage(t, "ok")).toBeNull();
  expect(typeMessage(t, "nameTaken")).toMatch(/already/);
});
