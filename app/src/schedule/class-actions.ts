// What the "⋯" menu of the class page offers, kept apart from the screen so it can be tested.
export type ClassAction = "edit" | "weekly" | "report" | "cancel" | "delete";

/**
 * The menu's rows, in the order they are shown. Edit and cancel are for whoever may change the
 * class; the weekly class and delete are the owner's (delete only for a class that is not part of a
 * weekly one); the report is offered once the class can have one.
 */
export function classActions(who: {
  mayChange: boolean;
  owner: boolean;
  inSeries: boolean;
  canReport: boolean;
}): ClassAction[] {
  const rows: (ClassAction | false)[] = [
    who.mayChange && "edit",
    who.owner && who.inSeries && "weekly",
    who.canReport && "report",
    who.mayChange && "cancel",
    who.mayChange && who.owner && !who.inSeries && "delete",
  ];
  return rows.filter((r): r is ClassAction => r !== false);
}
