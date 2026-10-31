import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  title: string;
  onPress: () => void;
  // primary: the one main action (orange); link: quiet underlined text; outline: the secondary
  // button, a quiet fill ("Show later"); choice: one of several answers, navy when `selected`
  variant?: "primary" | "link" | "outline" | "choice";
  selected?: boolean;
  busy?: boolean;
  disabled?: boolean;
  // a link that does something that cannot be undone, in the danger colour
  danger?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  selected = false,
  busy = false,
  disabled = false,
  danger = false,
}: Props) {
  const { colors } = useTheme();
  const off = disabled || busy;
  const filled = variant === "primary" || (variant === "choice" && selected);
  const orange = variant === "primary";

  const box =
    variant === "link"
      ? styles.link
      : variant === "outline"
        ? [styles.outline, { backgroundColor: colors.secondary }]
        : [
            styles.filled,
            orange
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : filled
                ? { backgroundColor: colors.text, borderColor: colors.text }
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
        <ActivityIndicator color={orange ? colors.onAccent : filled ? colors.background : colors.textMuted} />
      ) : (
        <Text
          variant="label"
          color={orange ? "onAccent" : filled ? "background" : variant === "choice" || variant === "outline" ? "text" : danger ? "danger" : "textMuted"}
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
  filled: { minHeight: 52, borderRadius: radius.md, borderWidth: 1 },
  large: { fontSize: 16, lineHeight: 22, textAlign: "center" },
  link: { paddingHorizontal: space.lg },
  linkText: { fontSize: 15, textDecorationLine: "underline" },
  outline: { alignSelf: "center", paddingHorizontal: space.lg, borderRadius: radius.md },
  disabled: { opacity: 0.4 },
});
