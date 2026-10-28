import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// One name in the "who is coming" list. People on the waiting list also show their place in line.
export function PersonRow({ name, position }: { name: string; position?: number | null }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View
      accessible
      accessibilityLabel={position ? t("session.personInLine", { name, position }) : name}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <Text variant="label" style={styles.name}>
        {name}
      </Text>
      {position ? (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption">{position}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  name: { flex: 1, fontSize: 16, lineHeight: 22 },
  badge: { minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
