import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { deleteMessage, type DeleteOutcome } from "@/auth/delete-account";
import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  // Deletes the account. "ok" signs the app out (this sheet goes away with the screen), anything
  // else is shown here.
  onDelete: (password: string) => Promise<DeleteOutcome>;
  onClose: () => void;
};

// Opens from "Delete account" in the account sheet: what will happen, and the password to confirm.
// Mounted only while open, so the password never outlives the sheet.
export function DeleteAccountSheet({ onDelete, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // While the request runs the sheet cannot be dismissed: a half-sent deletion has no undo.
  const close = () => {
    if (!busy) onClose();
  };

  async function confirm() {
    setBusy(true);
    setMessage(null);
    const outcome = await onDelete(password);
    if (outcome === "ok") return; // signed out: the screen is already going away
    setBusy(false);
    setMessage(deleteMessage(t, outcome));
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={close}>
      <Pressable accessibilityLabel={t("common.cancel")} accessibilityRole="button" onPress={close} style={styles.backdrop} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl }]}>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text variant="title">{t("delete.title")}</Text>
            <Text color="danger">{t("delete.warning")}</Text>
            {(["delete.point1", "delete.point2", "delete.point3", "delete.point4"] as const).map((key) => (
              <Text key={key} color="textMuted">
                {`• ${t(key)}`}
              </Text>
            ))}
            <TextField
              label={t("delete.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            {message && (
              <Text color="danger" accessibilityRole="alert">
                {message}
              </Text>
            )}
          </ScrollView>
          <Button title={t("delete.confirm")} onPress={confirm} busy={busy} disabled={password === ""} />
          <Button variant="link" title={t("common.cancel")} onPress={close} disabled={busy} />
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
  scroll: { maxHeight: 420 },
  content: { gap: space.md },
});
