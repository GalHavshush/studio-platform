import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { SessionFields } from "@/components/session-fields";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { editDurations } from "@/schedule/edit-session";
import { seatsValue, showSeats, type ClassTypeChoice } from "@/schedule/new-session";
import type { Series } from "@/schedule/series";
import { editedMessage, failureMessage, seriesForm, seriesPatch } from "@/schedule/series-actions";
import { useSeries } from "@/schedule/use-series";
import { useSeriesActions } from "@/schedule/use-series-actions";
import { useStaff } from "@/schedule/use-staff";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// An owner's form for the rule of a weekly class: coach, start time, length and seats.
export default function EditSeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const t = useT();
  const list = useSeries();
  const found = list.status === "ready" ? list.series.find((s) => s.id === id) : undefined;
  const type = list.status === "ready" ? list.types.find((c) => c.id === found?.class_type_id) : undefined;

  return (
    <Screen>
      <PageHeader title={t("seriesScreen.editTitle")} backLabel={t("series.back")} />
      {list.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {list.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("series.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={list.retry} />
        </View>
      )}
      {list.status === "ready" && !found && (
        <View style={styles.center}>
          <Text>{t("seriesScreen.gone")}</Text>
        </View>
      )}
      {found && <Form series={found} type={type} refresh={list.refresh} />}
    </Screen>
  );
}

function Form({ series, type, refresh }: { series: Series; type: ClassTypeChoice | undefined; refresh: () => Promise<void> }) {
  const { studio: s, user } = useSession();
  const studio = s as Studio;
  const staff = useStaff(true);
  const actions = useSeriesActions(series.id);
  const insets = useSafeAreaInsets();
  const t = useT();
  const [now] = useState(Date.now);
  const [form, setForm] = useState(() => seriesForm(series, now, studio.timezone));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const seatsShown = showSeats(type, studio.modules);
  const change = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const patch = seriesPatch(form, series, seatsShown);
  const valid = !seatsShown || seatsValue(form.seats) !== "invalid";

  async function save() {
    setBusy(true);
    setMessage(null);
    const { outcome, data } = await actions.edit(patch);
    if (outcome === "ok" && data) {
      await refresh();
      setMessage({ text: editedMessage(t, data), failed: false });
    } else {
      setMessage({ text: failureMessage(t, outcome) as string, failed: true });
    }
    setBusy(false);
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
          durations={editDurations(series.duration_minutes)}
          now={now}
          zone={studio.timezone}
          seatsShown={seatsShown}
          busy={busy}
          staff={staff}
          me={user?.id}
        />
        {message && (
          <Text color={message.failed ? "danger" : "text"} accessibilityRole={message.failed ? "alert" : undefined}>
            {message.text}
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
