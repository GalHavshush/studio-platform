import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// A small tag. `soft` is peach (a role); `ink` stands out the most (a cancelled class) and flips
// with the theme: dark on light, light on dark; `accent` is orange (something for you to read);
// `outline` is a quiet white tag with a hairline (a class you did not attend).
export function Pill({ label, tone = "soft" }: { label: string; tone?: "soft" | "ink" | "accent" | "outline" }) {
  const { colors } = useTheme();
  const look = {
    soft: { backgroundColor: colors.soft, color: "onSoft" },
    ink: { backgroundColor: colors.text, color: "background" },
    accent: { backgroundColor: colors.accent, color: "onAccent" },
    outline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: "textMuted" },
  } as const;
  const { color, ...box } = look[tone];
  return (
    <View style={[styles.pill, box]}>
      <Text variant="caption" color={color}>
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
