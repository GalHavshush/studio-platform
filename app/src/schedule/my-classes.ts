// What the "My classes" tab shows of a person's timeline, kept apart from the screen so it can be tested.
import type { Translator } from "@/i18n/translate";

import { planLabel } from "./plan";
import { dayKey, startOfWeek, type FirstDay } from "./time";
import { sharedNotes, type TimelineEntry } from "./timeline";

const monthOf = (instant: number, timeZone: string) => dayKey(instant, timeZone).slice(0, 7);

/** Classes still ahead (soonest first) and classes that have started (newest first, as loaded). */
export function splitByNow(items: TimelineEntry[], now: number) {
  const ahead = items.filter((e) => Date.parse(e.starts_at) > now);
  return { upcoming: ahead.reverse(), past: items.filter((e) => Date.parse(e.starts_at) <= now) };
}

/** The two numbers on top: classes attended and notes shared with the person, this calendar month. */
// ponytail: counted over the pages loaded so far (the newest 20 classes); upgrade to a server count if a
// busy member's month spills past the first page.
export function monthStats(items: TimelineEntry[], now: number, timeZone: string) {
  const month = monthOf(now, timeZone);
  const mine = items.filter((e) => monthOf(Date.parse(e.starts_at), timeZone) === month);
  return {
    attended: mine.filter((e) => e.attended === true).length,
    notes: mine.reduce((n, e) => n + sharedNotes(e).length, 0),
  };
}

export type PastGroup = { key: string; label: string; entries: TimelineEntry[] };

/** Past classes under "This week", then one group per month ("Earlier in October", "September 2026"). */
export function groupPast(past: TimelineEntry[], now: number, timeZone: string, firstDay: FirstDay, t: Translator) {
  const weekStart = startOfWeek(now, timeZone, firstDay);
  const thisMonth = monthOf(now, timeZone);
  const month = (at: number, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(t.locale, { timeZone, month: "long", ...opts }).format(new Date(at));
  const groups: PastGroup[] = [];
  for (const e of past) {
    const at = Date.parse(e.starts_at);
    const key = at >= weekStart ? "week" : monthOf(at, timeZone);
    let group = groups[groups.length - 1];
    if (group?.key !== key) {
      const label =
        key === "week"
          ? t("myClasses.thisWeek")
          : key === thisMonth
            ? t("myClasses.earlierIn", { month: month(at, {}) })
            : month(at, { year: "numeric" });
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(e);
  }
  return groups;
}

/** The small line under a past class: what there is to read, else what the person had said. */
export function pastLine(t: Translator, e: TimelineEntry): string | null {
  const note = sharedNotes(e).length > 0;
  if (e.summary && note) return t("myClasses.summaryAndNote");
  if (e.summary) return t("myClasses.summary");
  if (note) return t("myClasses.note");
  return e.booking ? t("myClasses.saidPlan", { plan: planLabel(t, e.booking) }) : null;
}
