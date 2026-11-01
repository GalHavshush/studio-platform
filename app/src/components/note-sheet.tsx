import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { MAX_LENGTH, type Attendee, type NoteDraft } from "@/schedule/report";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  person: Attendee;
  classLine: string; // "Morning Yoga · Tue 3 Nov"
  note: NoteDraft;
  disabled: boolean;
  onSave: (note: NoteDraft) => void; // puts the note in the report form; the report's own Save sends it
  onRemove: () => void;
  onClose: () => void;
};

// One person's note on the report, opened from their row. It edits a draft, so closing without
// "Save note" changes nothing. Mounted only while open, so every opening starts from the form.
export function NoteSheet({ person, classLine, note, disabled, onSave, onRemove, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [draft, setDraft] = useState(note);
  const first = person.name.split(/\s+/)[0];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel={t("common.cancel")} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl }]}>
          <Text variant="eyebrow">{t("report.noteFor", { name: person.name })}</Text>
          <Text color="textMuted">{classLine}</Text>
          <Button
            variant="link"
            title={t("report.timeline")}
            onPress={() => {
              onClose();
              router.push({ pathname: "/timeline/[id]", params: { id: person.participant_id, name: person.name } });
            }}
          />
          <TextField
            label={t("report.noteFor", { name: person.name })}
            value={draft.body}
            onChangeText={(body) => setDraft((d) => ({ ...d, body }))}
            multiline
            maxLength={MAX_LENGTH}
            editable={!disabled}
            style={styles.input}
          />
          <View style={styles.shareRow}>
            <View style={styles.shareText}>
              <Text>{t("report.share", { name: first })}</Text>
              <Text variant="caption" color="textMuted">
                {draft.shared ? t("report.sharedHint", { name: first }) : t("report.privateHint")}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t("report.share", { name: first })}
              value={draft.shared}
              onValueChange={(shared) => setDraft((d) => ({ ...d, shared }))}
              disabled={disabled}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <Button title={t("report.saveNote")} onPress={() => { onSave(draft); onClose(); }} disabled={disabled} />
          <Button variant="link" title={t("report.remove", { name: first })} onPress={() => { onClose(); onRemove(); }} disabled={disabled} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.md,
  },
  shareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  shareText: { flex: 1 },
  input: { minHeight: 120, paddingTop: space.md, paddingBottom: space.md, textAlignVertical: "top", borderRadius: radius.md },
});
