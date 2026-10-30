import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { TimelineCard } from "@/components/timeline-card";
import { useT } from "@/i18n/use-language";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { entryStatus, statusLabel, type TimelineEntry } from "@/schedule/timeline";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = { entry: TimelineEntry; timeZone: string; now: number; open: boolean; onToggle: () => void };

// One class of the history in a line; tapping it opens the full card under it.
export function HistoryRow({ entry, timeZone, now, open, onToggle }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const start = Date.parse(entry.starts_at);
  const status = entryStatus(entry, now);
  const when = `${formatDay(startOfDay(start, timeZone), now, timeZone, t)} · ${formatTime(start, timeZone, t.locale)}`;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("history.rowLabel", { title: entry.class_type_name, when })}
        onPress={onToggle}
        style={[styles.row, { backgroundColor: colors.surface }]}
      >
        <View style={styles.text}>
          <Text variant="label" color="textMuted">
            {when}
          </Text>
          <Text variant="title" numberOfLines={2}>
            {entry.class_type_name}
          </Text>
        </View>
        <Pill label={statusLabel(t, status)} tone={status === "cancelled" ? "ink" : "soft"} />
      </Pressable>
      {open && <TimelineCard entry={entry} timeZone={timeZone} now={now} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    padding: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg - 4,
  },
  text: { flex: 1, gap: 2 },
});
