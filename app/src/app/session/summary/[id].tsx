import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { entryStatus, sharedNotes, statusLabel } from "@/schedule/timeline";
import { useNow } from "@/schedule/use-now";
import { useTimeline } from "@/schedule/use-timeline";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// A class that is over, as its member sees it: what happened to them, the coach's summary and the
// notes shared with them.
export default function ClassSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const studio = useSession().studio as Studio;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const now = useNow(60_000);
  const timeline = useTimeline(studio.participantId as string);
  // ponytail: found among the pages loaded, the newest 20 classes; a class further back shows as not
  // available. Upgrade to a fetch by session id if members reach that far.
  const entry = timeline.status === "ready" ? timeline.items.find((e) => e.session_id === id) : undefined;

  if (!entry) {
    return (
      <Screen>
        <PageHeader title={t("summary.title")} backLabel={t("timeline.back")} />
        <View style={styles.center}>
          {timeline.status === "loading" ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : timeline.status === "error" ? (
            <>
              <Text color="danger" accessibilityRole="alert">
                {t("timeline.loadError")}
              </Text>
              <Button variant="link" title={t("common.tryAgain")} onPress={timeline.retry} />
            </>
          ) : (
            <Text color="textMuted">{t("timeline.notAvailable")}</Text>
          )}
        </View>
      </Screen>
    );
  }

  const start = Date.parse(entry.starts_at);
  const status = entryStatus(entry, now);
  const notes = sharedNotes(entry);
  const day = formatDay(startOfDay(start, studio.timezone), now, studio.timezone, t);
  return (
    <Screen>
      <PageHeader
        title={entry.class_type_name}
        subtitle={`${day} · ${formatTime(start, studio.timezone, t.locale)}`}
        backLabel={t("timeline.back")}
      />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
        <Pill label={statusLabel(t, status)} tone={status === "cancelled" ? "ink" : status === "attended" ? "soft" : "outline"} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="eyebrow" color="textMuted">
            {t("summary.title")}
          </Text>
          <Text color={entry.summary ? "text" : "textMuted"}>{entry.summary ?? t("summary.none")}</Text>
        </View>
        {notes.length > 0 && (
          <>
            <View style={[styles.card, styles.note, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text variant="eyebrow">{t("summary.note")}</Text>
              {notes.map((n) => (
                <Text key={n.id}>{n.body}</Text>
              ))}
            </View>
            <Text variant="label" color="textMuted" style={styles.hint}>
              {t("summary.noteHint")}
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  body: { padding: space.xl, gap: space.lg },
  card: { borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg, gap: space.sm },
  note: { borderWidth: 2 },
  hint: { textAlign: "center" },
});
