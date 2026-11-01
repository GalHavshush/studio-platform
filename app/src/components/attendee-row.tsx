import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { initials, noteLabel, type NoteDraft } from "@/schedule/report";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = { name: string; note: NoteDraft; onPress: () => void };

// One attendee of the report in a line: initials, name and what is written ("Shared note",
// "Staff note", "Add note"). A tap opens the note sheet; the text lives in the form, not here.
export function AttendeeRow({ name, note, onPress }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const label = noteLabel(note);
  const tag = { none: t("report.addNote"), staff: t("report.staffNote"), shared: t("report.sharedNote") }[label];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("report.rowLabel", { name })}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.soft }]}>
        <Text variant="caption" color="onSoft">
          {initials(name)}
        </Text>
      </View>
      <Text variant="rowName" style={styles.name}>
        {name}
      </Text>
      <Text variant="caption" color={label === "none" ? "textMuted" : "text"}>
        {tag}
      </Text>
      <Text variant="title" color="textMuted">
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  avatar: { width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  name: { flex: 1 },
});
