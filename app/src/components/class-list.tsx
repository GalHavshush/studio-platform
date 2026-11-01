import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// A white hairline card holding rows, with a hairline between them.
export function ClassList({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {Children.toArray(children).map((child, i) => (
        <View key={i}>
          {i > 0 && <View style={[styles.sep, { backgroundColor: colors.border }]} />}
          {child}
        </View>
      ))}
    </View>
  );
}

type Props = {
  day: string; // "27"
  weekday: string; // "TUE"
  title: string;
  line?: string | null;
  tag?: ReactNode; // a Pill
  label: string; // what a screen reader says for the whole row
  onPress: () => void;
};

// One class of a person's list: the date as a block, the class name with a line under it, a tag.
export function DateRow({ day, weekday, title, line, tag, label, onPress }: Props) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}>
      <View style={styles.date}>
        <Text variant="time">{day}</Text>
        <Text variant="caption" color="textMuted" style={styles.weekday}>
          {weekday}
        </Text>
      </View>
      <View style={styles.text}>
        <Text variant="title" numberOfLines={2}>
          {title}
        </Text>
        {line ? (
          <Text variant="label" color="textMuted">
            {line}
          </Text>
        ) : null}
      </View>
      {tag}
      <Text variant="title" color="textMuted">
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg - 4, borderWidth: 1, overflow: "hidden" },
  sep: { height: 1, marginLeft: space.lg },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  date: { width: 40, alignItems: "center" },
  weekday: { textTransform: "uppercase" },
  text: { flex: 1 },
});
