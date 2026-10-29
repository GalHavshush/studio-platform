import { StyleSheet, View } from "react-native";

import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { planLabel } from "@/schedule/plan";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { entryStatus, noteMeta, statusLabel, type TimelineEntry } from "@/schedule/timeline";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = { entry: TimelineEntry; timeZone: string; now: number };

// One class in a person's history: when, what happened to them, the summary and the notes.
export function TimelineCard({ entry, timeZone, now }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const start = Date.parse(entry.starts_at);
  const status = entryStatus(entry, now);
  const when = `${formatDay(startOfDay(start, timeZone), now, timeZone, t)} · ${formatTime(start, timeZone, t.locale)}`;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text variant="label" color="textMuted">
            {when}
          </Text>
          <Text variant="title">{entry.class_type_name}</Text>
        </View>
        <Pill label={statusLabel(t, status)} tone={status === "cancelled" ? "ink" : "soft"} />
      </View>
      {entry.booking && (
        <Text color="textMuted">{t("timeline.plan", { plan: planLabel(t, entry.booking) })}</Text>
      )}
      {entry.summary && (
        <View style={styles.block}>
          <Text variant="eyebrow">{t("timeline.summary")}</Text>
          <Text>{entry.summary}</Text>
        </View>
      )}
      {entry.notes.length > 0 && (
        <View style={styles.block}>
          <Text variant="eyebrow">{t("timeline.notes")}</Text>
          {entry.notes.map((n) => (
            <View key={n.id} style={styles.note}>
              <Text>{n.body}</Text>
              {noteMeta(t, n) && (
                <Text variant="caption" color="textMuted">
                  {noteMeta(t, n)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md },
  titles: { flex: 1, gap: space.xs },
  block: { gap: space.xs },
  note: { gap: 2 },
});
