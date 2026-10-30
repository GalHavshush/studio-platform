import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { ChoiceChip } from "@/components/choice-chip";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { modeChoices, toBody, typeForm, typeMessage, type ClassType, type Mode } from "@/schedule/class-types";
import { useClassTypes } from "@/schedule/use-class-types";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// One screen for both: the id "new" creates a class type, any other id edits that one.
export default function ClassTypeFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const t = useT();
  const types = useClassTypes();
  const creating = id === "new";
  const type = types.status === "ready" ? types.types.find((c) => c.id === id) : undefined;

  return (
    <Screen>
      <PageHeader title={t(creating ? "classTypes.formNew" : "classTypes.formEdit")} backLabel={t("classTypes.back")} />
      {types.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {types.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("classTypes.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={types.retry} />
        </View>
      )}
      {types.status === "ready" && !creating && !type && (
        <View style={styles.center}>
          <Text>{t("classTypes.gone")}</Text>
        </View>
      )}
      {types.status === "ready" && (creating || type) && <Form type={type} types={types} />}
    </Screen>
  );
}

function Form({ type, types }: { type: ClassType | undefined; types: ReturnType<typeof useClassTypes> }) {
  const { studio } = useSession();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [form, setForm] = useState(() => typeForm(type));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const body = toBody(form, type);
  const choices = modeChoices(studio?.modules ?? [], typeForm(type).mode);

  async function save() {
    if (!body) return;
    setBusy(true);
    setMessage(null);
    const outcome = await (type ? types.update(type.id, body) : types.create(body));
    setBusy(false);
    if (outcome === "ok") router.back();
    else setMessage(typeMessage(t, outcome));
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          label={t("classTypes.name")}
          value={form.name}
          onChangeText={(name) => setForm({ ...form, name })}
          maxLength={100}
          editable={!busy}
        />
        <View style={styles.group}>
          <Text variant="label">{t("classTypes.mode")}</Text>
          <View style={styles.chips}>
            {choices.map((mode: Mode) => (
              <ChoiceChip
                key={mode}
                label={t(mode === "rsvp" ? "classTypes.rsvp" : "classTypes.booking")}
                selected={form.mode === mode}
                onPress={() => !busy && setForm({ ...form, mode })}
              />
            ))}
          </View>
        </View>
        {message && (
          <Text color="danger" accessibilityRole="alert">
            {message}
          </Text>
        )}
        <Button title={t(type ? "classTypes.save" : "classTypes.create")} onPress={save} busy={busy} disabled={!body} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  form: { padding: space.xl, gap: space.xl },
  group: { gap: space.sm },
  chips: { flexDirection: "row", gap: space.sm },
});
