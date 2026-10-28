import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "link";
  busy?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = "primary", busy = false, disabled = false }: Props) {
  const { colors } = useTheme();
  const off = disabled || busy;
  const primary = variant === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={[
        styles.base,
        primary ? [styles.filled, { backgroundColor: colors.primary }] : styles.link,
        primary && disabled && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.textMuted} />
      ) : (
        <Text
          variant="label"
          color={primary ? "onPrimary" : "textMuted"}
          style={primary ? styles.primaryText : styles.linkText}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt is the smallest comfortable touch target; the primary button is taller.
  base: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  filled: { minHeight: 56 },
  primaryText: { fontSize: 16, lineHeight: 22 },
  link: { paddingHorizontal: space.lg },
  linkText: { fontSize: 15, textDecorationLine: "underline" },
  disabled: { opacity: 0.5 },
});
