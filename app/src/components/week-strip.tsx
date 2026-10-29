import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export type StripDay = {
  key: string;
  letter: string;
  number: string;
  label: string; // for a screen reader
  today: boolean;
  past: boolean;
  hasClasses: boolean;
};

type Props = { title: string; range: string; days: StripDay[] };

// "This week" with its dates, and the seven days under it: today filled, past days faded, a dot under
// each day that has classes. It only shows where we are; it is not a control.
export function WeekStrip({ title, range, days }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text variant="title">{title}</Text>
        <Text variant="label" color="textMuted">
          {range}
        </Text>
      </View>
      <View style={styles.days}>
        {days.map((d) => {
          const fg = d.today ? colors.onPrimary : colors.text;
          return (
            <View
              key={d.key}
              accessible
              accessibilityLabel={d.label}
              style={[
                styles.day,
                { backgroundColor: d.today ? colors.primary : colors.surface },
                d.past && styles.past,
              ]}
            >
              <Text variant="caption" style={{ color: fg }}>
                {d.letter}
              </Text>
              <Text variant="title" style={[styles.number, { color: fg }]}>
                {d.number}
              </Text>
              <View style={[styles.dot, d.hasClasses && { backgroundColor: fg }]} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  days: { flexDirection: "row", gap: space.xs },
  day: { flex: 1, minHeight: 68, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: radius.md },
  number: { fontSize: 18, lineHeight: 24, letterSpacing: 0, fontVariant: ["tabular-nums"] },
  dot: { width: 5, height: 5, borderRadius: 3 },
  past: { opacity: 0.55 },
});
