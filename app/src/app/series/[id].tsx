import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { comingRows, scheduledTo, seriesFacts } from "@/schedule/series";
import { endedMessage, extendedMessage, failureMessage, type ActionOutcome } from "@/schedule/series-actions";
import { useNow } from "@/schedule/use-now";
import { useSeries } from "@/schedule/use-series";
import { useSeriesActions } from "@/schedule/use-series-actions";
import { useSeriesSessions } from "@/schedule/use-series-sessions";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// One weekly class: what repeats, the classes coming up, and what the owner can do to it.
export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { studio } = useSession();
  const now = useNow(60_000);
  const zone = studio?.timezone ?? "UTC";
  const list = useSeries();
  const coming = useSeriesSessions(id);
  const actions = useSeriesActions(id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const series = list.status === "ready" ? list.series.find((s) => s.id === id) : undefined;
  const facts = list.status === "ready" && series ? seriesFacts(t, series, list.types, list.staff) : undefined;
  const sessions = coming.status === "ready" ? coming.sessions : [];
  const until = scheduledTo(t, sessions, zone);

  // Runs one action: its failure is worded under the buttons, its success by `done`.
  async function act<T>(call: Promise<{ outcome: ActionOutcome; data?: T }>, done: (data: T) => string | null) {
    setBusy(true);
    setMessage(null);
    const { outcome, data } = await call;
    if (outcome === "ok") {
      await Promise.all([list.refresh(), coming.refresh()]);
      const text = done(data as T);
      if (text) setMessage({ text, failed: false });
    } else {
      setMessage({ text: failureMessage(t, outcome) as string, failed: true });
    }
    setBusy(false);
  }

  function askEnd() {
    Alert.alert(t("seriesScreen.endAsk"), t("seriesScreen.endAskBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("seriesScreen.end"),
        style: "destructive",
        onPress: () => void act(actions.end(), (ended) => endedMessage(t, ended)),
      },
    ]);
  }

  function askDelete() {
    Alert.alert(t("seriesScreen.deleteAsk"), t("seriesScreen.deleteAskBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("seriesScreen.delete"),
        style: "destructive",
        onPress: () =>
          void act(actions.remove(), () => {
            router.back();
            return null;
          }),
      },
    ]);
  }

  return (
    <Screen>
      <PageHeader title={t("seriesScreen.title")} backLabel={t("series.back")} />
      {list.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {list.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("series.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={list.retry} />
        </View>
      )}
      {list.status === "ready" && !series && (
        <View style={styles.center}>
          <Text>{t("seriesScreen.gone")}</Text>
        </View>
      )}
      {facts && (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="eyebrow" color="textMuted">
              {facts.every}
            </Text>
            <Text variant="time">{facts.time}</Text>
            <Text variant="title">{facts.title}</Text>
            {facts.rows.map((row) => (
              <View key={row.label} style={styles.fact}>
                <Text color="textMuted">{row.label}</Text>
                <Text>{row.value}</Text>
              </View>
            ))}
          </View>
          <Button
            title={t("seriesScreen.edit")}
            onPress={() => router.push({ pathname: "/series/edit/[id]", params: { id } })}
            disabled={busy}
          />
          <Button
            variant="choice"
            title={t("seriesScreen.extend")}
            onPress={() => void act(actions.extend(), (r) => extendedMessage(t, r.created))}
            busy={busy}
          />
          {message && (
            <Text color={message.failed ? "danger" : "text"} accessibilityRole={message.failed ? "alert" : undefined}>
              {message.text}
            </Text>
          )}

          <View style={styles.sectionHead}>
            <Text variant="eyebrow" color="textMuted">
              {t("seriesScreen.comingUp")}
            </Text>
            {until && <Text color="textMuted">{until}</Text>}
          </View>
          {coming.status === "loading" && <ActivityIndicator color={colors.textMuted} />}
          {coming.status === "error" && <Text color="danger">{t("series.loadError")}</Text>}
          {coming.status === "ready" && sessions.length === 0 && <Text color="textMuted">{t("seriesScreen.noneComing")}</Text>}
          {comingRows(t, sessions, now, zone).map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`${row.day}, ${row.note}`}
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: row.id } })}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text variant="title" color={row.cancelled ? "textMuted" : "text"}>
                {row.day}
              </Text>
              <Text color="textMuted">{row.note}</Text>
            </Pressable>
          ))}

          <Text variant="eyebrow" color="textMuted" style={styles.stop}>
            {t("seriesScreen.stop")}
          </Text>
          <View style={styles.danger}>
            <Button variant="link" title={t("seriesScreen.end")} onPress={askEnd} disabled={busy} danger />
            <Text variant="caption" color="textMuted" style={styles.hint}>
              {t("seriesScreen.endHint")}
            </Text>
          </View>
          <View style={styles.danger}>
            <Button variant="link" title={t("seriesScreen.delete")} onPress={askDelete} disabled={busy} danger />
            <Text variant="caption" color="textMuted" style={styles.hint}>
              {t("seriesScreen.deleteHint")}
            </Text>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  body: { padding: space.xl, gap: space.lg },
  card: { padding: space.lg, gap: space.xs, borderRadius: radius.lg - 4, borderWidth: 1 },
  fact: { flexDirection: "row", justifyContent: "space-between", paddingTop: space.xs },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.lg,
    borderRadius: radius.lg - 4,
    borderWidth: 1,
  },
  stop: { marginTop: space.lg },
  danger: { alignItems: "center", gap: space.xs },
  hint: { textAlign: "center" },
});
