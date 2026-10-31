import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Tone = "surface" | "accent" | "soft" | "primary" | "muted";

// For each tone: the fill, the text on it, and the colour of the small label.
const TONES: Record<Tone, { bg: ColorName; fg: ColorName; label: ColorName }> = {
  surface: { bg: "surface", fg: "text", label: "textMuted" },
  accent: { bg: "accent", fg: "onAccent", label: "onAccent" },
  soft: { bg: "soft", fg: "onSoft", label: "onSoft" },
  primary: { bg: "primary", fg: "onPrimary", label: "soft" },
  muted: { bg: "surfaceMuted", fg: "text", label: "text" },
};

type Props = {
  label: string;
  value: string;
  tone?: Tone;
  // a big number above its label (the RSVP counts) instead of a small label above a line of text
  figure?: boolean;
};

export function Tile({ label, value, tone = "surface", figure = false }: Props) {
  const { colors } = useTheme();
  const t = TONES[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.tile, { backgroundColor: colors[t.bg] }]}
    >
      {figure ? (
        <>
          <Text variant="figure" color={t.fg}>
            {value}
          </Text>
          <Text variant="label" color={t.label}>
            {label}
          </Text>
        </>
      ) : (
        <>
          <Text variant="eyebrow" color={t.label} style={styles.small}>
            {label}
          </Text>
          <Text variant="title" color={t.fg}>
            {value}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.lg - 4, padding: space.lg, gap: 2 },
  small: { fontSize: 12, letterSpacing: 0.7 },
});
