import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  name: string;
  sub?: string | null;
  // true or false draws the tick circle (the class is open for roll call); null draws a chevron that opens the person's history
  checked: boolean | null;
  label: string; // what a screen reader says for the row
  onPress: () => void;
};

// One person of the class in a line: with `checked` a tap marks them as having come.
export function RollCallRow({ name, sub, checked, label, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={checked === null ? "button" : "checkbox"}
      accessibilityState={checked === null ? undefined : { checked }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <View style={styles.text}>
        <Text variant="rowName">{name}</Text>
        {sub ? (
          <Text variant="caption" color="textMuted">
            {sub}
          </Text>
        ) : null}
      </View>
      {checked === null ? (
        <Text variant="title" color="textMuted">
          ›
        </Text>
      ) : (
        <View style={[styles.tick, checked ? { backgroundColor: colors.text, borderColor: colors.text } : { borderColor: colors.border }]}>
          {checked && <Text variant="label" color="background">✓</Text>}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
  tick: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
