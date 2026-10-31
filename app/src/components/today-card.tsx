import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import type { ChipTone } from "@/schedule/chip";
import type { TodayState } from "@/schedule/week";
import { radius, space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const CHIP: Record<ChipTone, { bg: ColorName; fg: ColorName }> = {
  accent: { bg: "accent", fg: "onAccent" },
  soft: { bg: "soft", fg: "onSoft" },
  primary: { bg: "primary", fg: "onPrimary" },
};

// The block the schedule is about: a blue card holding today's classes under a big "Today".
export function TodayCard({ title, date, children }: { title: string; date: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.primary }]}>
      <View style={styles.head}>
        <Text variant="heading" color="onPrimary" style={styles.title}>
          {title}
        </Text>
        <Text variant="label" color="soft">
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
  tone: ChipTone;
  // "done" classes are faded, the "next" one stands out in the accent colour; undefined for a
  // cancelled class
  state?: TodayState;
  cancelled?: boolean;
  onPress: () => void;
};

// One of today's classes: bigger than a row of another day, so the day reads as the main thing.
export function TodayRow({ time, title, tone, state, cancelled = false, onPress }: RowProps) {
  const { colors } = useTheme();
  const t = useT();
  const next = state === "next";
  const chip = CHIP[tone];
  const fg: ColorName = cancelled ? "textMuted" : next ? "onAccent" : "text";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(cancelled ? "schedule.rowLabelCancelled" : "schedule.rowLabel", { time, title })}
      onPress={onPress}
      style={[
        styles.row,
        cancelled
          ? { borderColor: colors.border, borderStyle: "dashed", borderWidth: 1.5 }
          : { backgroundColor: next ? colors.accent : colors.surface },
        state === "done" && styles.done,
      ]}
    >
      <View
        style={[
          styles.chip,
          { backgroundColor: cancelled ? colors.surfaceMuted : next ? colors.soft : colors[chip.bg] },
        ]}
      >
        <Text
          variant="title"
          color={cancelled ? "textMuted" : next ? "onSoft" : chip.fg}
          style={[styles.time, cancelled && styles.struck]}
        >
          {time}
        </Text>
      </View>
      <Text variant="title" color={fg} style={[styles.name, cancelled && styles.struck]} numberOfLines={2}>
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
        <Text variant="title" color="textMuted">
          ›
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg - 4, paddingHorizontal: space.lg, paddingTop: space.xl - 4, paddingBottom: space.sm, gap: space.sm },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: space.xs, paddingBottom: space.sm },
  title: { fontSize: 36, lineHeight: 36 },
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    padding: space.sm,
    paddingRight: space.lg,
    borderRadius: radius.lg - 6,
    marginBottom: space.sm,
  },
  done: { opacity: 0.6 },
  chip: { minWidth: 76, minHeight: 60, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  time: { fontVariant: ["tabular-nums"], paddingHorizontal: space.sm },
  name: { flex: 1 },
  struck: { textDecorationLine: "line-through" },
  tag: { alignSelf: "center" },
});
