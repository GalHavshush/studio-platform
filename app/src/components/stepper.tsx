import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = { value: string; onUp: () => void; onDown: () => void; upLabel: string; downLabel: string };

// A number with a button each side to move it, for the hour and the minute of a start time.
export function Stepper({ value, onUp, onDown, upLabel, downLabel }: Props) {
  const { colors } = useTheme();
  const button = (label: string, glyph: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text variant="title">{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {button(downLabel, "−", onDown)}
      <Text variant="title" style={styles.value}>
        {value}
      </Text>
      {button(upLabel, "+", onUp)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  button: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1.5 },
  value: { minWidth: 44, textAlign: "center", fontVariant: ["tabular-nums"] },
});
