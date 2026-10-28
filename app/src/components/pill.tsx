import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// A small tag. `soft` is peach (a role); `ink` stands out the most (a cancelled class) and flips
// with the theme: dark on light, light on dark.
export function Pill({ label, tone = "soft" }: { label: string; tone?: "soft" | "ink" }) {
  const { colors } = useTheme();
  const ink = tone === "ink";
  return (
    <View style={[styles.pill, { backgroundColor: ink ? colors.text : colors.soft }]}>
      <Text variant="caption" color={ink ? "background" : "onSoft"}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: space.md - 2,
    paddingVertical: space.xs,
  },
});
