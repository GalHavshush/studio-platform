import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  title: string;
  onPress: () => void;
  // primary: the one main action; link: quiet underlined text; outline: a small pill ("Show later");
  // choice: one of several answers, filled when `selected`
  variant?: "primary" | "link" | "outline" | "choice";
  selected?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  selected = false,
  busy = false,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const off = disabled || busy;
  const filled = variant === "primary" || (variant === "choice" && selected);

  const box =
    variant === "link"
      ? styles.link
      : variant === "outline"
        ? [styles.outline, { borderColor: colors.border }]
        : [
            styles.filled,
            filled
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: colors.surface, borderColor: colors.border },
          ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy, selected: variant === "choice" ? selected : undefined }}
      disabled={off}
      onPress={onPress}
      style={[styles.base, box, off && !busy && styles.disabled]}
    >
      {busy ? (
        <ActivityIndicator color={filled ? colors.onPrimary : colors.textMuted} />
      ) : (
        <Text
          variant="label"
          color={filled ? "onPrimary" : variant === "choice" ? "text" : "textMuted"}
          style={variant === "link" ? styles.linkText : variant === "outline" ? undefined : styles.large}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt is the smallest comfortable touch target; the filled buttons are taller.
  base: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  filled: { minHeight: 56, borderRadius: radius.md, borderWidth: 1.5 },
  large: { fontSize: 16, lineHeight: 22, textAlign: "center" },
  link: { paddingHorizontal: space.lg },
  linkText: { fontSize: 15, textDecorationLine: "underline" },
  outline: { alignSelf: "center", paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1.5 },
  disabled: { opacity: 0.4 },
});
