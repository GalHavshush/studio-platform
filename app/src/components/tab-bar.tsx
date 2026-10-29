import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The bar floats over the screens, so each one leaves this much room at the bottom of its content
// (the bar itself plus the gap under it; the safe area is added on top).
export const TAB_BAR_SPACE = 88;

const ICON = 24;
const STROKE = 2;

// The icons are drawn with plain views, so the bar needs no icon or SVG library.
function Icon({ name, color }: { name: string; color: string }) {
  const line = { backgroundColor: color, position: "absolute" as const };
  if (name === "index") {
    return (
      <View style={styles.icon}>
        <View style={[styles.calendar, { borderColor: color }]} />
        <View style={[line, { left: 2, right: 2, top: 9, height: STROKE }]} />
        <View style={[line, { left: 7, top: 2, width: STROKE, height: 5 }]} />
        <View style={[line, { right: 7, top: 2, width: STROKE, height: 5 }]} />
      </View>
    );
  }
  if (name === "timeline") {
    return (
      <View style={styles.icon}>
        <View style={[styles.clock, { borderColor: color }]} />
        <View style={[line, { left: 11, top: 6, width: STROKE, height: 7 }]} />
        <View style={[line, { left: 11, top: 11, width: 6, height: STROKE }]} />
      </View>
    );
  }
  // settings: two sliders
  return (
    <View style={styles.icon}>
      <View style={[line, { left: 2, right: 2, top: 6, height: STROKE }]} />
      <View style={[styles.knob, { borderColor: color, backgroundColor: "transparent", left: 13, top: 3 }]} />
      <View style={[line, { left: 2, right: 2, top: 16, height: STROKE }]} />
      <View style={[styles.knob, { borderColor: color, backgroundColor: "transparent", left: 5, top: 13 }]} />
    </View>
  );
}

// The floating tab bar: a rounded capsule over the content, the current tab filled with the primary
// colour. A route whose options say `href: null` has no tab (the member's own timeline when the
// studio has no participant for them).
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.bar,
        { bottom: insets.bottom, backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        if ((options as { href?: string | null }).href === null) return null;
        const focused = state.index === index;
        const label = options.title ?? route.name;
        const color = focused ? colors.onPrimary : colors.textMuted;

        function press() {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            onPress={press}
            style={[styles.tab, focused && { backgroundColor: colors.primary }]}
          >
            <Icon name={route.name} color={color} />
            <Text variant="caption" style={{ color }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: space.xl,
    right: space.xl,
    flexDirection: "row",
    gap: space.xs,
    padding: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: "#0B1A2B",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 8,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: radius.pill,
  },
  icon: { width: ICON, height: ICON },
  calendar: { position: "absolute", left: 2, right: 2, top: 4, bottom: 2, borderWidth: STROKE, borderRadius: 5 },
  clock: { position: "absolute", left: 2, right: 2, top: 2, bottom: 2, borderWidth: STROKE, borderRadius: 10 },
  knob: { position: "absolute", width: 8, height: 8, borderRadius: 4, borderWidth: STROKE },
});
