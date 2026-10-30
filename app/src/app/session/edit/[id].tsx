import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { SessionFields } from "@/components/session-fields";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { changeMessage, editDays, editDurations, editForm, toPatch } from "@/schedule/edit-session";
import { seatsValue, showSeats, times } from "@/schedule/new-session";
import { formatRange } from "@/schedule/time";
import { useSessionDetail, type SessionDetail } from "@/schedule/use-session";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function EditSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const t = useT();
  const detail = useSessionDetail(id);

  return (
    <Screen>
      <PageHeader title={t("editSession.title")} backLabel={t("editSession.back")} />
      {detail.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {detail.status === "notFound" && (
        <View style={styles.center}>
          <Text>{t("session.notAvailable")}</Text>
        </View>
      )}
      {detail.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("session.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={detail.retry} />
        </View>
      )}
      {detail.status === "ready" && <Form session={detail.session} edit={detail.edit} />}
    </Screen>
  );
}

function Form({ session, edit }: { session: SessionDetail; edit: ReturnType<typeof useSessionDetail>["edit"] }) {
  const studio = useSession().studio as Studio;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const zone = studio.timezone;
  const [now] = useState(Date.now);
  const [form, setForm] = useState(() => editForm(session, zone));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const days = useMemo(() => editDays(now, zone, editForm(session, zone).dayStart), [now, zone, session]);
  const durations = useMemo(() => editDurations(editForm(session, zone).duration), [zone, session]);

  const seatsShown = session.attendance_mode === "booking" && studio.modules.includes("booking");
  const change = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const { start, end } = times(form, zone);
  const patch = toPatch(form, session, zone, seatsShown);
  const valid = !seatsShown || seatsValue(form.seats) !== "invalid";

  async function save() {
    setBusy(true);
    setMessage(null);
    const outcome = await edit(patch);
    setBusy(false);
    if (outcome === "ok") router.back();
    else setMessage(changeMessage(t, outcome));
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <SessionFields
          form={form}
          change={change}
          days={days}
          durations={durations}
          now={now}
          zone={zone}
          seatsShown={seatsShown}
          busy={busy}
        />
        <TextField
          label={t("editSession.preview")}
          value={form.preview}
          onChangeText={(preview) => change({ preview })}
          multiline
          maxLength={2000}
          editable={!busy}
        />
        <Text variant="title">{formatRange(start, end, zone, t.locale)}</Text>
        {message && (
          <Text color="danger" accessibilityRole="alert">
            {message}
          </Text>
        )}
        <Button title={t("editSession.save")} onPress={save} busy={busy} disabled={!valid || Object.keys(patch).length === 0} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  form: { padding: space.xl, gap: space.xl },
});
