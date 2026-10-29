import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = { when: string; title: string; written: boolean; onPress: () => void };

// A class waiting for its report: the day and time, the class, and whether the report exists yet.
export function ReportRow({ when, title, written, onPress }: Props) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("reports.rowLabel", { title, when })}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <View style={styles.text}>
        <Text variant="label" color="textMuted">
          {when}
        </Text>
        <Text variant="title" numberOfLines={2}>
          {title}
        </Text>
      </View>
      {written ? <Pill label={t("reports.written")} tone="ink" /> : <Pill label={t("reports.toWrite")} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
