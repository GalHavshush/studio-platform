import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Tone = "surface" | "accent" | "soft" | "primary" | "muted";

// The small dot that names a count's kind; a plain tile has none.
const DOT: Record<Tone, ColorName | null> = {
  surface: null,
  accent: "accent",
  soft: "soft",
  primary: "primary",
  muted: "textMuted",
};

type Props = {
  label: string;
  value: string;
  tone?: Tone;
  // a big number above its label (the RSVP counts) instead of a small label above a line of text
  figure?: boolean;
};

// A white hairline card with a label and a value. The tone only picks the colour of a small dot.
export function Tile({ label, value, tone = "surface", figure = false }: Props) {
  const { colors } = useTheme();
  const dot = DOT[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {figure ? (
        <>
          <Text variant="figure">{value}</Text>
          <View style={styles.name}>
            {dot && <View style={[styles.dot, { backgroundColor: colors[dot] }]} />}
            <Text variant="label" color="textMuted">
              {label}
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text variant="eyebrow" color="textMuted">
            {label}
          </Text>
          <Text variant="title">{value}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg, gap: 2 },
  name: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
