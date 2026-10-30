import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  name: string;
  hasNote: boolean;
  shared: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode; // the note, its share switch and the links: shown only while the row is open
};

// One attendee of the report in a line, with what is already written ("Note", "Shared") visible
// without opening it. The text lives in the form, so closing a row loses nothing.
export function AttendeeRow({ name, hasNote, shared, open, onToggle, children }: Props) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("report.rowLabel", { name })}
        onPress={onToggle}
        style={[styles.row, { backgroundColor: colors.surface }]}
      >
        <Text variant="label" style={styles.name}>
          {name}
        </Text>
        {hasNote && (
          <View style={styles.tags}>
            <Pill label={t("report.hasNote")} />
            {shared && <Pill label={t("timeline.shared")} tone="ink" />}
          </View>
        )}
        <Text variant="title" color="textMuted">
          {open ? "⌃" : "›"}
        </Text>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  name: { flex: 1, fontSize: 16, lineHeight: 22 },
  // the pill pins itself to the top of its parent; this wrapper centres the pair in the row instead
  tags: { flexDirection: "row", gap: space.xs, alignSelf: "center" },
  body: { gap: space.sm, paddingHorizontal: space.xs },
});
