import { makeTranslator } from "@/i18n/translate";

import {
  EMPTY_FORM,
  canSave,
  canWriteReport,
  formFromReport,
  isDirty,
  noteFor,
  saveMessage,
  saveOutcome,
  toPayload,
  withNote,
} from "./report";

const t = makeTranslator("en");

test("a report from the server fills the form, a blank field becomes an empty string", () => {
  expect(formFromReport({ summary: "Good class", went_well: null, needs_work: "Guard", observations: null })).toEqual({
    summary: "Good class",
    went_well: "",
    needs_work: "Guard",
    observations: "",
    notes: {},
  });
  expect(formFromReport(null)).toEqual(EMPTY_FORM);
});

test("the payload trims, turns blank into null and always carries all four fields and the notes", () => {
  const payload = toPayload({ ...EMPTY_FORM, summary: "  Good class  ", went_well: "   ", observations: "x" });

  expect(payload).toEqual({
    summary: "Good class",
    went_well: null,
    needs_work: null,
    observations: "x",
    notes: [],
  });
});

test("a report needs text in a field or in a note", () => {
  expect(canSave(EMPTY_FORM)).toBe(false);
  expect(canSave({ ...EMPTY_FORM, summary: "   " })).toBe(false);
  expect(canSave({ ...EMPTY_FORM, observations: "x" })).toBe(true);
  expect(canSave(withNote(EMPTY_FORM, "p1", { body: "  " }))).toBe(false); // a blank note is no note
  expect(canSave(withNote(EMPTY_FORM, "p1", { body: "Good guard" }))).toBe(true);
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

// --- notes ---

const ANN = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

test("the server's notes fill the form by participant, with their sharing flag", () => {
  const form = formFromReport({
    summary: "x",
    notes: [
      { participant_id: ANN, body: "Strong", shared_with_member: true },
      { participant_id: BOB, body: "Tired", shared_with_member: false },
    ],
  });

  expect(noteFor(form, ANN)).toEqual({ body: "Strong", shared: true });
  expect(noteFor(form, BOB)).toEqual({ body: "Tired", shared: false });
});

test("someone with no note yet has an empty note that is private", () => {
  expect(noteFor(EMPTY_FORM, ANN)).toEqual({ body: "", shared: false });
  expect(withNote(EMPTY_FORM, ANN, { body: "Hi" }).notes[ANN]).toEqual({ body: "Hi", shared: false });
});

test("changing one person's note leaves everyone else's alone", () => {
  const form = formFromReport({ notes: [{ participant_id: BOB, body: "Tired", shared_with_member: true }] });
  const next = withNote(form, ANN, { shared: true });

  expect(next.notes[BOB]).toEqual({ body: "Tired", shared: true });
  expect(next.notes[ANN]).toEqual({ body: "", shared: true });
  expect(form.notes[ANN]).toBeUndefined(); // the old form is not changed
});

test("the payload sends each note with a strict sharing flag, trimmed, and leaves blank ones out", () => {
  let form = withNote(EMPTY_FORM, ANN, { body: "  Strong  ", shared: true });
  form = withNote(form, BOB, { body: "   ", shared: true }); // no text: no note, whatever the switch says

  expect(toPayload(form).notes).toEqual([
    { participant_id: ANN, body: "Strong", shared_with_member: true },
  ]);
});

test("a note of someone with no row on screen travels back untouched, so saving cannot delete it", () => {
  const loaded = formFromReport({
    summary: "x",
    notes: [{ participant_id: BOB, body: "Written before they were un-marked", shared_with_member: true }],
  });
  const edited = withNote(loaded, ANN, { body: "New" }); // the coach only ever touched Ann's row

  expect(toPayload(edited).notes).toEqual([
    { participant_id: BOB, body: "Written before they were un-marked", shared_with_member: true },
    { participant_id: ANN, body: "New", shared_with_member: false },
  ]);
});

test("a note is dirty when its text or its switch changed, and a blank note is not a change", () => {
  const saved = formFromReport({ summary: "x", notes: [{ participant_id: ANN, body: "Strong", shared_with_member: false }] });

  expect(isDirty(saved, saved)).toBe(false);
  expect(isDirty(withNote(saved, ANN, { body: "Stronger" }), saved)).toBe(true);
  expect(isDirty(withNote(saved, ANN, { shared: true }), saved)).toBe(true);
  expect(isDirty(withNote(saved, ANN, { body: "" }), saved)).toBe(true); // clearing deletes it
  expect(isDirty(withNote(saved, BOB, { shared: true }), saved)).toBe(false); // switch on an empty note
  expect(isDirty(withNote(saved, BOB, { body: "New" }), saved)).toBe(true);
});
