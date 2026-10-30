import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { seriesRows } from "@/schedule/series";
import { endedMessage, extendedMessage, failureMessage, type ActionOutcome } from "@/schedule/series-actions";
import { useSeries } from "@/schedule/use-series";
import { useSeriesActions } from "@/schedule/use-series-actions";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// One weekly class: what repeats, and what the owner can do to it.
export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const list = useSeries();
  const actions = useSeriesActions(id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const row =
    list.status === "ready"
      ? seriesRows(t, list.series.filter((s) => s.id === id), list.types, list.staff)[0]
      : undefined;

  // Runs one action: its failure is worded under the buttons, its success by `done`.
  async function act<T>(call: Promise<{ outcome: ActionOutcome; data?: T }>, done: (data: T) => string | null) {
    setBusy(true);
    setMessage(null);
    const { outcome, data } = await call;
    if (outcome === "ok") {
      await list.refresh();
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
      <PageHeader title={row?.title ?? t("series.title")} backLabel={t("series.back")} />
      {list.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {list.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("series.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={list.retry} />
        </View>
      )}
      {list.status === "ready" && !row && (
        <View style={styles.center}>
          <Text>{t("seriesScreen.gone")}</Text>
        </View>
      )}
      {row && (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text>{row.when}</Text>
            <Text color="textMuted">{row.coach}</Text>
            <Text color="textMuted">{row.range}</Text>
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
          <Button variant="link" title={t("seriesScreen.end")} onPress={askEnd} disabled={busy} danger />
          <Button variant="link" title={t("seriesScreen.delete")} onPress={askDelete} disabled={busy} danger />
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  body: { padding: space.xl, gap: space.lg },
  card: { padding: space.lg, gap: space.xs, borderRadius: radius.lg - 4 },
});
