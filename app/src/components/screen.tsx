import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The page itself. `accent` is for screens that open with the orange hero block.
export function Screen({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: accent ? colors.accent : colors.background }]}>
      {children}
    </View>
  );
}

// The orange block at the top. By default it grows to fill the space the sheet below leaves; with
// `compact` it is only as tall as its content and has rounded bottom corners (a page header).
export function Hero({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        compact ? styles.compact : styles.fill,
        { backgroundColor: colors.accent, paddingTop: insets.top + space.lg },
      ]}
    >
      {/* The hero is orange in light and dark mode, so its status bar content is always dark. */}
      <StatusBar style="dark" />
      {children}
    </View>
  );
}

// The rounded panel that slides up from the bottom, holding the form or the choices.
export function Sheet({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sheet,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: {
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: "flex-end",
    overflow: "hidden",
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    gap: space.xl,
  },
  compact: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: "hidden",
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    gap: space.lg,
  },
});
