import { StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { roleLabel } from "@/auth/role";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/use-language";
import { monogram } from "@/studio/monogram";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Whose studio this is: its monogram (until studios have a logo of their own), its name and the
// person's role there. Sits above the title of the three main screens.
export function StudioBadge() {
  const { studio } = useSession();
  const t = useT();
  if (!studio) return null;
  return (
    <View style={styles.row}>
      <StudioMark name={studio.name} />
      <Text variant="label" color="textMuted" numberOfLines={1} style={styles.name}>
        {studio.name}
      </Text>
      <Pill label={roleLabel(t, studio.role)} />
    </View>
  );
}

// The monogram alone, for a studio that is not the current one (the picker).
export function StudioMark({ name, size = 28 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const fontSize = Math.round(size * 0.42);
  return (
    <View
      style={[styles.mark, { backgroundColor: colors.text, width: size, height: size, borderRadius: radius.sm + size / 14 }]}
    >
      <Text variant="rowName" color="background" style={{ fontSize, lineHeight: fontSize + 4, letterSpacing: 0.5 }}>
        {monogram(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  mark: { alignItems: "center", justifyContent: "center" },
  name: { flexShrink: 1 },
});
