import { StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { ClassRow } from "@/components/class-row";
import { TimelineCard } from "@/components/timeline-card";
import { useT } from "@/i18n/use-language";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { entryStatus, statusLabel, type TimelineEntry } from "@/schedule/timeline";
import { space } from "@/theme/tokens";

type Props = { entry: TimelineEntry; timeZone: string; now: number; open: boolean; onToggle: () => void };

// One class of the history in a line; tapping it opens the full card under it.
export function HistoryRow({ entry, timeZone, now, open, onToggle }: Props) {
  const t = useT();
  const start = Date.parse(entry.starts_at);
  const status = entryStatus(entry, now);
  const when = `${formatDay(startOfDay(start, timeZone), now, timeZone, t)} · ${formatTime(start, timeZone, t.locale)}`;
  return (
    <View style={styles.wrap}>
      <ClassRow
        when={when}
        title={entry.class_type_name}
        tag={<Pill label={statusLabel(t, status)} tone={status === "cancelled" ? "ink" : "soft"} />}
        label={t("history.rowLabel", { title: entry.class_type_name, when })}
        expanded={open}
        onPress={onToggle}
      />
      {open && <TimelineCard entry={entry} timeZone={timeZone} now={now} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
});
