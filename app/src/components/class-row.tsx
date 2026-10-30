import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  when: string;
  title: string;
  tag: ReactNode; // a Pill: where this class stands (report written, attended, ...)
  label: string; // what a screen reader says for the whole row
  expanded?: boolean; // only for a row that opens something under itself
  onPress: () => void;
};

// A class in one line: the day and time, the class name and a tag. The report queue and the history
// both use it, so they look alike.
export function ClassRow({ when, title, tag, label, expanded, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <View style={styles.text}>
        <Text variant="label" color="textMuted">
          {when}
        </Text>
        <Text variant="title" numberOfLines={2}>
          {title}
        </Text>
      </View>
      {tag}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    padding: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg - 4,
  },
  text: { flex: 1, gap: 2 },
});
