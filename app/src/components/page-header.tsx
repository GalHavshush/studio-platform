import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { Logo } from "@/components/logo";
import { Text } from "@/components/text";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  title: string;
  // a line under the title (a class's date and time, whose timeline it is)
  subtitle?: string;
  // something small above the title (the person's role, "Cancelled")
  tag?: ReactNode;
  // with a label the header has a back button; without it, none (a top-level screen)
  backLabel?: string;
};

// The one-row orange header at the top of every page but sign in and choose studio: back button,
// title and a small logo.
export function PageHeader({ title, subtitle, tag, backLabel }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: colors.accent, paddingTop: insets.top + space.xs }]}>
      {/* The header is orange in light and dark mode, so its status bar content is always dark. */}
      <StatusBar style="dark" />
      {backLabel && <BackButton label={backLabel} />}
      <View style={styles.titles}>
        {tag}
        <Text variant="pageTitle" color="onAccent" numberOfLines={2}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="label" color="onAccent" style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </View>
      <Logo size={32} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  titles: { flex: 1, gap: space.xs },
  subtitle: { fontSize: 14, lineHeight: 20 },
});
