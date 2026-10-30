import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { ChoiceChip } from "@/components/choice-chip";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { SessionFields } from "@/components/session-fields";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import {
  DURATIONS,
  canCreate,
  createMessage,
  dayChoices,
  initialForm,
  showSeats,
  toSeriesPayload,
} from "@/schedule/new-session";
import { dateLabel, weekdayName } from "@/schedule/series";
import { useNewSeries } from "@/schedule/use-new-series";
import { useNewSession } from "@/schedule/use-new-session";
import { useStaff } from "@/schedule/use-staff";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// An owner's form for a class that repeats every week from a first day. The same fields as "New class".
export default function NewSeriesScreen() {
  const { studio: s, user } = useSession();
  const studio = s as Studio;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const zone = studio.timezone;
  const [now] = useState(Date.now);
  const days = useMemo(() => dayChoices(now, zone), [now, zone]);
  const [form, setForm] = useState(() => initialForm(now, zone));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const classTypes = useNewSession();
  const { create } = useNewSeries();
  const staff = useStaff(true);

  const chosen = classTypes.status === "ready" ? classTypes.types.find((c) => c.id === form.classTypeId) : undefined;
  const seatsShown = showSeats(chosen, studio.modules);
  const change = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const payload = toSeriesPayload(form, zone, seatsShown);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const outcome = await create(payload);
    setBusy(false);
    if (outcome === "ok") router.back();
    else setMessage(createMessage(t, outcome));
  }

  return (
    <Screen>
      <PageHeader title={t("newSeries.title")} backLabel={t("newSeries.back")} />
      {classTypes.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {classTypes.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("newSession.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={classTypes.retry} />
        </View>
      )}
      {classTypes.status === "ready" && (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + space.xl }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.group}>
              <Text variant="eyebrow">{t("newSession.classType")}</Text>
              {classTypes.types.length === 0 && <Text color="textMuted">{t("newSession.noTypes")}</Text>}
              <View style={styles.wrap}>
                {classTypes.types.map((c) => (
                  <ChoiceChip
                    key={c.id}
                    label={c.name}
                    selected={form.classTypeId === c.id}
                    onPress={() => change({ classTypeId: c.id })}
                  />
                ))}
              </View>
            </View>

            <SessionFields
              form={form}
              change={change}
              days={days}
              durations={DURATIONS}
              now={now}
              zone={zone}
              seatsShown={seatsShown}
              busy={busy}
              staff={staff}
              me={user?.id}
            />

            <Text variant="title">
              {t("newSeries.summary", {
                day: weekdayName(payload.weekday, t.locale),
                from: dateLabel(payload.first_date, t.locale),
              })}
            </Text>
            {message && (
              <Text color="danger" accessibilityRole="alert">
                {message}
              </Text>
            )}
            <Button title={t("newSeries.create")} onPress={submit} busy={busy} disabled={!canCreate(form, seatsShown)} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  form: { padding: space.xl, gap: space.xl },
  group: { gap: space.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
