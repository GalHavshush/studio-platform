import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// One name in the "who is coming" list. People on the waiting list also show their place in line.
// With `onPress` the row opens that person's timeline and shows a chevron, like a schedule row.
type Props = { name: string; position?: number | null; onPress?: () => void };

export function PersonRow({ name, position, onPress }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const label = position ? t("session.personInLine", { name, position }) : name;
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? t("timeline.of", { name }) : label}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <Text variant="rowName" style={styles.name}>
        {name}
      </Text>
      {position ? (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption">{position}</Text>
        </View>
      ) : null}
      {onPress && (
        <Text variant="title" color="textMuted">
          ›
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  name: { flex: 1 },
  badge: { minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
