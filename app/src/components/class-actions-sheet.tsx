import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import type { ClassAction } from "@/schedule/class-actions";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The round "⋯" button at the end of the page header, the same size as the back button.
export function MoreButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("actions.more")}
      onPress={onPress}
      style={[styles.more, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text variant="title" style={styles.dots}>
        ⋯
      </Text>
    </Pressable>
  );
}

type Props = {
  actions: ClassAction[];
  classLine: string; // "Morning Yoga · Tue 3 Nov"
  onPick: (action: ClassAction) => void; // the sheet closes first; the screen does the rest
  onClose: () => void;
};

// The "⋯" menu of the class page: one row per thing staff can do with this class. Mounted only while open.
export function ClassActionsSheet({ actions, classLine, onPick, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const rows: Record<ClassAction, { title: string; hint?: string; danger?: boolean }> = {
    edit: { title: t("actions.edit") },
    weekly: { title: t("actions.weekly") },
    report: { title: t("actions.report") },
    cancel: { title: t("session.cancelClass"), hint: t("actions.cancelHint") },
    delete: { title: t("session.deleteClass"), hint: t("actions.deleteHint"), danger: true },
  };
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel={t("actions.close")} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl }]}>
        <Text variant="eyebrow">{t("actions.title")}</Text>
        <Text color="textMuted">{classLine}</Text>
        {actions.map((a) => (
          <Pressable
            key={a}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onPick(a);
            }}
            style={[styles.row, { backgroundColor: colors.surface }]}
          >
            <Text variant="rowName" color={rows[a].danger ? "danger" : "text"}>
              {rows[a].title}
            </Text>
            {rows[a].hint && (
              <Text variant="caption" color="textMuted">
                {rows[a].hint}
              </Text>
            )}
          </Pressable>
        ))}
        <Button variant="link" title={t("actions.close")} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  more: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dots: { fontSize: 24, lineHeight: 28 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.md,
  },
  row: { minHeight: 56, justifyContent: "center", gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md },
});
