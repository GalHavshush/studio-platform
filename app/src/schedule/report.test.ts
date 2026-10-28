import { makeTranslator } from "@/i18n/translate";

import {
  EMPTY_FORM,
  canSave,
  canWriteReport,
  formFromReport,
  isDirty,
  saveMessage,
  saveOutcome,
  toPayload,
} from "./report";

const t = makeTranslator("en");

test("a report from the server fills the form, a blank field becomes an empty string", () => {
  expect(formFromReport({ summary: "Good class", went_well: null, needs_work: "Guard", observations: null })).toEqual({
    summary: "Good class",
    went_well: "",
    needs_work: "Guard",
    observations: "",
  });
  expect(formFromReport(null)).toEqual(EMPTY_FORM);
});

test("the payload trims, turns blank into null and always carries all four fields, but no notes", () => {
  const payload = toPayload({ summary: "  Good class  ", went_well: "   ", needs_work: "", observations: "x" });

  expect(payload).toEqual({ summary: "Good class", went_well: null, needs_work: null, observations: "x" });
  expect(payload).not.toHaveProperty("notes");
});

test("a report needs text in at least one field", () => {
  expect(canSave(EMPTY_FORM)).toBe(false);
  expect(canSave({ ...EMPTY_FORM, summary: "   " })).toBe(false);
  expect(canSave({ ...EMPTY_FORM, observations: "x" })).toBe(true);
});

test("the form is dirty when any field differs from the saved one", () => {
  const saved = formFromReport({ summary: "a" });

  expect(isDirty(saved, saved)).toBe(false);
  expect(isDirty({ ...saved, needs_work: "b" }, saved)).toBe(true);
  expect(isDirty({ ...saved, summary: "a " }, saved)).toBe(true);
});

test("the report is offered to staff, once the class has started, and not when it is cancelled", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const started = { rsvp_counts: {}, status: "scheduled", starts_at: "2026-10-29T11:00:00Z" };

  expect(canWriteReport(started, now)).toBe(true);
  expect(canWriteReport({ ...started, starts_at: "2026-10-29T12:00:00Z" }, now)).toBe(true);
  expect(canWriteReport({ ...started, starts_at: "2026-10-29T12:00:01Z" }, now)).toBe(false);
  expect(canWriteReport({ ...started, status: "cancelled" }, now)).toBe(false);
  expect(canWriteReport({ ...started, rsvp_counts: null }, now)).toBe(false);
});

test("each refusal of the server has its own outcome and message", () => {
  expect(saveOutcome(422, "empty_report")).toBe("empty");
  expect(saveOutcome(409, "session_not_started")).toBe("notStarted");
  expect(saveOutcome(409, "session_cancelled")).toBe("cancelled");
  expect(saveOutcome(403, "not_your_session")).toBe("notYours");
  expect(saveOutcome(403, "insufficient_role")).toBe("error");
  expect(saveOutcome(500, undefined)).toBe("error");

  expect(saveMessage(t, "ok")).toBeNull();
  const outcomes = ["empty", "notStarted", "cancelled", "notYours", "unreachable", "error"] as const;
  const messages = outcomes.map((o) => saveMessage(t, o));
  expect(new Set(messages).size).toBe(outcomes.length);
});
