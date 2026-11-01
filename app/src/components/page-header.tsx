import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { Text } from "@/components/text";
import { space } from "@/theme/tokens";

type Props = {
  title: string;
  // a line under the title (a class's date and time, whose timeline it is)
  subtitle?: string;
  // something small above the title (the person's role, "Cancelled")
  tag?: ReactNode;
  // with a label the header has a back button; without it, none (a top-level screen)
  backLabel?: string;
  // a button at the far end of the bar (the class page's "⋯")
  action?: ReactNode;
};

// The plain header at the top of every page but sign in and choose studio: back button and title.
export function PageHeader({ title, subtitle, tag, backLabel, action }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.xs }]}>
      <StatusBar style="auto" />
      {backLabel && <BackButton label={backLabel} />}
      <View style={styles.titles}>
        {tag}
        <Text variant="pageTitle" color="text" numberOfLines={2}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="label" color="textMuted" style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  titles: { flex: 1, gap: space.xs },
  subtitle: { fontSize: 14, lineHeight: 20 },
});
