import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import type { TodayState } from "@/schedule/week";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The block the schedule is about: a white card holding today's classes under a big "Today".
export function TodayCard({ title, date, children }: { title: string; date: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Text variant="heading" style={styles.title}>
          {title}
        </Text>
        <Text variant="label" color="textMuted">
          {date}
        </Text>
      </View>
      {children}
    </View>
  );
}

type RowProps = {
  time: string;
  title: string;
  // "done" classes are faded, the "next" one gets the orange edge and a tag; undefined for a
  // cancelled class
  state?: TodayState;
  cancelled?: boolean;
  onPress: () => void;
};

// One of today's classes: a bigger row than another day's, so the day reads as the main thing.
export function TodayRow({ time, title, state, cancelled = false, onPress }: RowProps) {
  const { colors } = useTheme();
  const t = useT();
  const next = state === "next";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(cancelled ? "schedule.rowLabelCancelled" : "schedule.rowLabel", { time, title })}
      onPress={onPress}
      style={[styles.row, { borderTopColor: colors.border }, state === "done" && styles.done]}
    >
      <View style={[styles.bar, { backgroundColor: next ? colors.accent : colors.border }]} />
      <Text variant="time" color={cancelled ? "textMuted" : "text"} style={[styles.time, cancelled && styles.struck]}>
        {time}
      </Text>
      <Text variant="title" color={cancelled ? "textMuted" : "text"} style={[styles.name, cancelled && styles.struck]} numberOfLines={2}>
        {title}
      </Text>
      {cancelled ? (
        <View style={styles.tag}>
          <Pill label={t("common.cancelled")} tone="ink" />
        </View>
      ) : next ? (
        <View style={styles.tag}>
          <Pill label={t("schedule.next")} />
        </View>
      ) : (
        <Text variant="title" color="textMuted" style={styles.chevron}>
          ›
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg - 4, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  title: { fontSize: 36, lineHeight: 36 },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: space.md, paddingRight: space.lg, borderTopWidth: 1 },
  bar: { width: 4, alignSelf: "stretch" },
  done: { opacity: 0.6 },
  time: { minWidth: 64 },
  name: { flex: 1 },
  struck: { textDecorationLine: "line-through" },
  tag: { alignSelf: "center" },
  chevron: { paddingLeft: space.xs },
});
