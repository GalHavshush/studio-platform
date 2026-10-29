import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Logo } from "@/components/logo";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The page itself. `accent` is for screens that open with the orange hero block.
export function Screen({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.screen, { backgroundColor: accent ? colors.accent : colors.background }, accent && styles.clip]}
    >
      {children}
    </View>
  );
}

// The tall orange block on sign in and choose studio. It grows to fill the space the sheet below
// leaves. With `logoSize` the logo mark is drawn large behind the content, bleeding off the right edge
// and tucked under the sheet (the sheet is later in the layer order), so the figure seems to rise
// out of it.
export function Hero({ children, logoSize }: { children: ReactNode; logoSize?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { paddingTop: insets.top + space.lg }, !logoSize && styles.clip]}>
      {/* The hero is orange in light and dark mode, so its status bar content is always dark. */}
      <StatusBar style="dark" />
      {logoSize ? (
        <Logo
          mark
          size={logoSize}
          style={{ position: "absolute", right: -logoSize * 0.14, bottom: -logoSize * 0.13 }}
        />
      ) : null}
      <View style={styles.content}>{children}</View>
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
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    zIndex: 1,
  },
  clip: { overflow: "hidden" },
  content: { gap: space.xl, zIndex: 1 },
  sheet: {
    zIndex: 2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    gap: space.lg,
  },
});
