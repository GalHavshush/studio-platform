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
  times,
  toPayload,
} from "@/schedule/new-session";
import { formatRange } from "@/schedule/time";
import { useStaff } from "@/schedule/use-staff";
import { useNewSession } from "@/schedule/use-new-session";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function NewSessionScreen() {
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
  const staff = useStaff(studio.role === "owner");

  const chosen = classTypes.status === "ready" ? classTypes.types.find((c) => c.id === form.classTypeId) : undefined;
  const seatsShown = showSeats(chosen, studio.modules);
  const change = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const { start, end } = times(form, zone);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const { outcome, id } = await classTypes.create(toPayload(form, zone, seatsShown));
    setBusy(false);
    if (outcome === "ok" && id) router.replace({ pathname: "/session/[id]", params: { id } });
    else setMessage(createMessage(t, outcome));
  }

  return (
    <Screen>
      <PageHeader title={t("newSession.title")} backLabel={t("newSession.back")} />
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

            <Text variant="title">{formatRange(start, end, zone, t.locale)}</Text>
            {message && (
              <Text color="danger" accessibilityRole="alert">
                {message}
              </Text>
            )}
            <Button title={t("newSession.create")} onPress={submit} busy={busy} disabled={!canCreate(form, seatsShown)} />
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
