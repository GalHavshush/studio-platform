import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { attendMessage, type AttendOutcome } from "@/schedule/attendance";
import type { Attendee } from "@/schedule/report";
import { useParticipantSearch } from "@/schedule/use-participant-search";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  attendees: Attendee[];
  // Marks the person as having come; "ok" closes the sheet, anything else is shown in it.
  onPick: (person: Attendee) => Promise<AttendOutcome>;
  onClose: () => void;
};

// Opens from "Add someone" on the report: search the whole studio and mark the chosen person as
// having come to this class. Mounted only while open, so every opening starts with a fresh search.
export function AddAttendeeSheet({ attendees, onPick, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { text, setText, state, retry } = useParticipantSearch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const here = new Set(attendees.map((a) => a.participant_id));

  async function pick(person: Attendee) {
    setBusy(true);
    setMessage(null);
    const outcome = await onPick(person);
    setBusy(false);
    if (outcome === "ok") onClose();
    else setMessage(attendMessage(t, outcome));
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel={t("common.cancel")} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl }]}>
          <Text variant="eyebrow">{t("search.title")}</Text>
          <Text color="textMuted">{t("search.hint")}</Text>
          <TextField label={t("search.label")} value={text} onChangeText={setText} autoCorrect={false} />
          {message && (
            <Text color="danger" accessibilityRole="alert">
              {message}
            </Text>
          )}
          <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
            {state.status === "error" && (
              <View style={styles.center}>
                <Text color="danger" accessibilityRole="alert">
                  {t("search.error")}
                </Text>
                <Button variant="link" title={t("common.tryAgain")} onPress={retry} />
              </View>
            )}
            {state.status === "ready" && state.people.length === 0 && <Text color="textMuted">{t("search.empty")}</Text>}
            {state.status === "ready" &&
              state.people.map((p) => {
                const already = here.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: already || busy }}
                    disabled={already || busy}
                    onPress={() => pick({ participant_id: p.id, name: p.name })}
                    style={[styles.row, { backgroundColor: colors.surface }, (already || busy) && styles.dim]}
                  >
                    <Text variant="label" style={styles.name}>
                      {p.name}
                    </Text>
                    {already && <Text variant="caption" color="textMuted">{t("search.alreadyHere")}</Text>}
                  </Pressable>
                );
              })}
          </ScrollView>
          <Button variant="link" title={t("common.cancel")} onPress={onClose} />
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
  results: { maxHeight: 280 },
  center: { alignItems: "center", gap: space.xs },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  name: { flex: 1 },
  dim: { opacity: 0.5 },
});
