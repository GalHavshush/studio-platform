import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { ChoiceChip } from "@/components/choice-chip";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { SessionFields } from "@/components/session-fields";
import { Text } from "@/components/text";
import { UntilRow } from "@/components/until-row";
import { useT } from "@/i18n/use-language";
import {
  DURATIONS,
  canCreate,
  createMessage,
  dayChoices,
  formFromLastClass,
  initialForm,
  showSeats,
  times,
  toPayload,
  toSeriesPayload,
  untilBeforeStart,
} from "@/schedule/new-session";
import { dateLabel, weekdayName } from "@/schedule/series";
import { formatRange } from "@/schedule/time";
import { useStaff } from "@/schedule/use-staff";
import { useNewSeries } from "@/schedule/use-new-series";
import { useNewSession } from "@/schedule/use-new-session";
import { useSchedule } from "@/schedule/use-schedule";
import { useWeekStart } from "@/schedule/use-week-start";
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
  const owner = studio.role === "owner";
  const { create: createSeries } = useNewSeries();
  // the "New weekly class" button on the weekly classes list opens this form with the switch already on
  const { repeat } = useLocalSearchParams<{ repeat?: string }>();
  const [weekly, setWeekly] = useState(owner && repeat === "1");
  const [until, setUntil] = useState<string | null>(null);
  const { firstDay } = useWeekStart();
  const schedule = useSchedule(zone, firstDay);
  // Starts from the last class once, when both lists have arrived, unless the person already changed something.
  const [prefilled, setPrefilled] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    if (prefilled || touched.current || schedule.status !== "ready" || classTypes.status !== "ready") return;
    const patch = formFromLastClass(schedule.all, classTypes.types.map((c) => c.id), Date.now(), zone, user?.id);
    if (patch) {
      setForm((f) => ({ ...f, ...patch }));
      setPrefilled(true);
    }
  }, [prefilled, schedule.status, schedule.all, classTypes, zone, user?.id]);

  const chosen = classTypes.status === "ready" ? classTypes.types.find((c) => c.id === form.classTypeId) : undefined;
  const seatsShown = showSeats(chosen, studio.modules);
  const change = (patch: Partial<typeof form>) => {
    touched.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };
  const { start, end } = times(form, zone);
  const series = toSeriesPayload(form, zone, seatsShown);
  const endsEarly = untilBeforeStart(series.first_date, until);

  async function submit() {
    setBusy(true);
    setMessage(null);
    if (weekly) {
      const outcome = await createSeries(toSeriesPayload(form, zone, seatsShown, until));
      setBusy(false);
      if (outcome === "ok") router.back();
      else setMessage(createMessage(t, outcome));
      return;
    }
    const { outcome, id } = await classTypes.create(toPayload(form, zone, seatsShown));
    setBusy(false);
    if (outcome === "ok" && id) router.replace({ pathname: "/session/[id]", params: { id } });
    else setMessage(createMessage(t, outcome));
  }

  return (
    <Screen>
      <PageHeader title={t(weekly ? "newSeries.title" : "newSession.title")} backLabel={t("newSession.back")} />
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
            {prefilled && <Text color="textMuted">{t("newSession.prefilled")}</Text>}
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

            {owner && (
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text>{t("newSession.repeat")}</Text>
                  <Text variant="caption" color="textMuted">
                    {t("newSession.repeatHint")}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={t("newSession.repeat")}
                  value={weekly}
                  onValueChange={setWeekly}
                  disabled={busy}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            )}

            {weekly && <UntilRow until={until} firstDate={series.first_date} onChange={setUntil} disabled={busy} />}

            <Text variant="title">
              {weekly
                ? t(until ? "newSeries.summaryUntil" : "newSeries.summary", {
                    day: weekdayName(series.weekday, t.locale),
                    from: dateLabel(series.first_date, t.locale),
                    until: until ? dateLabel(until, t.locale) : "",
                  })
                : `${formatRange(start, end, zone, t.locale)}${chosen ? ` · ${chosen.name}` : ""}`}
            </Text>
            {weekly && endsEarly && <Text color="danger">{t("newSeries.untilBeforeStart")}</Text>}
            {message && (
              <Text color="danger" accessibilityRole="alert">
                {message}
              </Text>
            )}
            <Button title={t(weekly ? "newSeries.create" : "newSession.create")} onPress={submit} busy={busy} disabled={!canCreate(form, seatsShown) || (weekly && endsEarly)} />
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
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  switchText: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
