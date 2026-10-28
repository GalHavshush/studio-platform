import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { Text } from "@/components/text";
import { fontFamily, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = TextInputProps & { label: string };

export function TextField({ label, style, onFocus, onBlur, ...rest }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.group}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: focused ? colors.primary : colors.border,
            color: colors.text,
          },
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  input: {
    minHeight: 56,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    fontFamily: fontFamily.semibold,
    fontSize: 16,
  },
});
