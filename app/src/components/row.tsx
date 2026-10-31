import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import type { ChipTone } from "@/schedule/chip";
import { radius, space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const CHIP: Record<ChipTone, ColorName> = { accent: "accent", soft: "soft", primary: "primary" };

type Props = {
  time: string;
  title: string;
  tone: ChipTone;
  cancelled?: boolean;
  onPress: () => void;
};

// One line of the schedule: a white card with the time, the class name, a coloured edge for its
// type and a chevron to open it. A cancelled class stays in the list, struck through and dashed,
// so nobody thinks it vanished.
export function Row({ time, title, tone, cancelled = false, onPress }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const edge = colors[CHIP[tone]];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(cancelled ? "schedule.rowLabelCancelled" : "schedule.rowLabel", { time, title })}
      onPress={onPress}
      style={[
        styles.row,
        cancelled
          ? { borderColor: colors.border, borderStyle: "dashed" }
          : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: cancelled ? colors.border : edge }]} />
      <Text variant="time" color={cancelled ? "textMuted" : "text"} style={[styles.time, cancelled && styles.struck]}>
        {time}
      </Text>
      <Text
        variant="title"
        color={cancelled ? "textMuted" : "text"}
        style={[styles.title, cancelled && styles.struck]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {cancelled ? (
        <View style={styles.tag}>
          <Pill label={t("common.cancelled")} tone="ink" />
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
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingRight: space.lg,
    borderRadius: radius.lg - 4,
    borderWidth: 1,
    overflow: "hidden",
  },
  bar: { width: 4, alignSelf: "stretch" },
  time: { minWidth: 64 },
  title: { flex: 1 },
  struck: { textDecorationLine: "line-through" },
  // the pill pins itself to the top of its parent; this wrapper centres it in the row instead
  tag: { alignSelf: "center" },
});
