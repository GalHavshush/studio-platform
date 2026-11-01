import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useTheme } from "@/theme/use-theme";

// The bar sits over the bottom of the screens, so each one leaves this much room at the bottom of
// its content (the bar itself; the safe area is added on top).
export const TAB_BAR_SPACE = 64;

const ICON = 24;
const STROKE = 2;

// The icons are drawn with plain views, so the bar needs no icon or SVG library.
function Icon({ name, color }: { name: string; color: string }) {
  const line = { backgroundColor: color, position: "absolute" as const };
  if (name === "home") {
    return (
      <View style={styles.icon}>
        <View style={[styles.roof, { borderColor: color }]} />
        <View style={[styles.house, { borderColor: color }]} />
      </View>
    );
  }
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
  if (name === "reports") {
    return (
      <View style={styles.icon}>
        <View style={[styles.page, { borderColor: color }]} />
        <View style={[line, { left: 8, right: 8, top: 8, height: STROKE }]} />
        <View style={[line, { left: 8, right: 8, top: 13, height: STROKE }]} />
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

// The flat tab bar: a white strip with a hairline on top, the current tab in orange. A route whose options say `href: null` has no tab (the member's own timeline when the
// studio has no participant for them).
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: insets.bottom, backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        if ((options as { href?: string | null }).href === null) return null;
        const focused = state.index === index;
        const label = options.title ?? route.name;
        const color = focused ? colors.accent : colors.textMuted;

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
            style={styles.tab}
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
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    borderTopWidth: 1,
  },
  tab: { flex: 1, minHeight: TAB_BAR_SPACE, alignItems: "center", justifyContent: "center", gap: 2 },
  icon: { width: ICON, height: ICON },
  page: { position: "absolute", left: 4, right: 4, top: 2, bottom: 2, borderWidth: STROKE, borderRadius: 4 },
  calendar: { position: "absolute", left: 2, right: 2, top: 4, bottom: 2, borderWidth: STROKE, borderRadius: 5 },
  roof: { position: "absolute", left: 6, top: 3, width: 12, height: 12, borderLeftWidth: STROKE, borderTopWidth: STROKE, transform: [{ rotate: "45deg" }] },
  house: { position: "absolute", left: 4, right: 4, top: 11, bottom: 2, borderWidth: STROKE, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  clock: { position: "absolute", left: 2, right: 2, top: 2, bottom: 2, borderWidth: STROKE, borderRadius: 10 },
  knob: { position: "absolute", width: 8, height: 8, borderRadius: 4, borderWidth: STROKE },
});
