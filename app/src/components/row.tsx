import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import type { ChipTone } from "@/schedule/chip";
import { radius, space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const CHIP: Record<ChipTone, { bg: ColorName; fg: ColorName }> = {
  accent: { bg: "accent", fg: "onAccent" },
  soft: { bg: "soft", fg: "onSoft" },
  primary: { bg: "primary", fg: "onPrimary" },
};

type Props = {
  time: string;
  title: string;
  tone: ChipTone;
  cancelled?: boolean;
  onPress: () => void;
};

// One line of the schedule: a coloured time chip, the class name, and a chevron to open it.
// A cancelled class stays in the list, struck through and outlined, so nobody thinks it vanished.
export function Row({ time, title, tone, cancelled = false, onPress }: Props) {
  const { colors } = useTheme();
  const chip = CHIP[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${time} ${title}${cancelled ? ", cancelled" : ""}`}
      onPress={onPress}
      style={[
        styles.row,
        cancelled
          ? { borderColor: colors.border, borderStyle: "dashed", borderWidth: 1.5 }
          : { backgroundColor: colors.surface },
      ]}
    >
      <View style={[styles.chip, { backgroundColor: cancelled ? colors.surfaceMuted : colors[chip.bg] }]}>
        <Text
          variant="label"
          color={cancelled ? "textMuted" : chip.fg}
          style={[styles.time, cancelled && styles.struck]}
        >
          {time}
        </Text>
      </View>
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
          <Pill label="Cancelled" tone="ink" />
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
    gap: space.lg,
    padding: 6,
    paddingRight: space.lg,
    borderRadius: radius.lg - 4,
  },
  chip: { minWidth: 64, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  time: { fontSize: 16, lineHeight: 22, fontVariant: ["tabular-nums"], paddingHorizontal: space.sm },
  title: { flex: 1, fontSize: 17 },
  struck: { textDecorationLine: "line-through" },
  // the pill pins itself to the top of its parent; this wrapper centres it in the row instead
  tag: { alignSelf: "center" },
});
