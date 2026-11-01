import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props<T extends string> = { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void };

// Two or three choices side by side, the chosen one raised on a white pill.
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.secondary }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.option, on && { backgroundColor: colors.surface }]}
          >
            <Text variant="label" color={on ? "text" : "textMuted"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", padding: 3, borderRadius: radius.md },
  option: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 38, borderRadius: radius.md - 3, paddingHorizontal: space.md },
});
