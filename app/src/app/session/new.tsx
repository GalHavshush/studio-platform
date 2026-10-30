import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { ChoiceChip } from "@/components/choice-chip";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Stepper } from "@/components/stepper";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import {
  DURATIONS,
  MINUTE_STEP,
  canCreate,
  createMessage,
  dayChoices,
  initialForm,
  seatsValue,
  showSeats,
  times,
  toPayload,
  wrap,
} from "@/schedule/new-session";
import { formatDay, formatRange } from "@/schedule/time";
import { useNewSession } from "@/schedule/use-new-session";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const two = (n: number) => String(n).padStart(2, "0");

export default function NewSessionScreen() {
  const studio = useSession().studio as Studio;
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

            <View style={styles.group}>
              <Text variant="eyebrow">{t("newSession.day")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {days.map((d) => (
                  <ChoiceChip
                    key={d}
                    label={formatDay(d, now, zone, t)}
                    selected={form.dayStart === d}
                    onPress={() => change({ dayStart: d })}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.group}>
              <Text variant="eyebrow">{t("newSession.start")}</Text>
              <View style={styles.time}>
                <Stepper
                  value={two(form.hour)}
                  onUp={() => change({ hour: wrap(form.hour, 1, 24) })}
                  onDown={() => change({ hour: wrap(form.hour, -1, 24) })}
                  upLabel={t("newSession.up", { what: t("newSession.hour") })}
                  downLabel={t("newSession.down", { what: t("newSession.hour") })}
                />
                <Text variant="title">:</Text>
                <Stepper
                  value={two(form.minute)}
                  onUp={() => change({ minute: wrap(form.minute, MINUTE_STEP, 60) })}
                  onDown={() => change({ minute: wrap(form.minute, -MINUTE_STEP, 60) })}
                  upLabel={t("newSession.up", { what: t("newSession.minute") })}
                  downLabel={t("newSession.down", { what: t("newSession.minute") })}
                />
              </View>
            </View>

            <View style={styles.group}>
              <Text variant="eyebrow">{t("newSession.length")}</Text>
              <View style={styles.wrap}>
                {DURATIONS.map((m) => (
                  <ChoiceChip
                    key={m}
                    label={t("newSession.minutes", { n: m })}
                    selected={form.duration === m}
                    onPress={() => change({ duration: m })}
                  />
                ))}
              </View>
            </View>

            {seatsShown && (
              <View style={styles.group}>
                <TextField
                  label={t("newSession.seats")}
                  value={form.seats}
                  onChangeText={(seats) => change({ seats })}
                  keyboardType="number-pad"
                  maxLength={4}
                  editable={!busy}
                />
                <Text color={seatsValue(form.seats) === "invalid" ? "danger" : "textMuted"}>
                  {seatsValue(form.seats) === "invalid" ? t("newSession.seatsInvalid") : t("newSession.seatsHint")}
                </Text>
              </View>
            )}

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
  chips: { flexDirection: "row", gap: space.sm },
  time: { flexDirection: "row", alignItems: "center", gap: space.md },
});
