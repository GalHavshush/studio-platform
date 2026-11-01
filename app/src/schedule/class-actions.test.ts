import { classActions } from "./class-actions";

const none = { mayChange: false, owner: false, inSeries: false, canReport: false };

test("a member gets no menu", () => {
  expect(classActions(none)).toEqual([]);
});

test("a coach of the class may edit, write the report and cancel, but not delete or open the weekly class", () => {
  expect(classActions({ ...none, mayChange: true, canReport: true, inSeries: true })).toEqual(["edit", "report", "cancel"]);
});

test("an owner of a single class can delete it", () => {
  expect(classActions({ mayChange: true, owner: true, inSeries: false, canReport: false })).toEqual(["edit", "cancel", "delete"]);
});

test("an owner of a weekly class opens the weekly class instead of deleting", () => {
  expect(classActions({ mayChange: true, owner: true, inSeries: true, canReport: true })).toEqual([
    "edit",
    "weekly",
    "report",
    "cancel",
  ]);
});

test("the report alone is a menu", () => {
  expect(classActions({ ...none, canReport: true })).toEqual(["report"]);
});
