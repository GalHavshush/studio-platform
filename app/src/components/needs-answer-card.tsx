import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import type { ScheduledSession } from "@/schedule/use-schedule";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  sessions: ScheduledSession[];
  more: number;
  nameOf: (s: ScheduledSession) => string;
  timeZone: string;
  now: number;
  onOpen: (id: string) => void;
};

// The classes waiting for the member's answer, each opening its class page. The orange edge marks
// it as the one thing to do on this screen.
export function NeedsAnswerCard({ sessions, more, nameOf, timeZone, now, onOpen }: Props) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.edge, { backgroundColor: colors.accent }]} />
      <View style={styles.body}>
        <Text variant="eyebrow" color="textMuted" style={styles.title}>
          {t("schedule.needsAnswer")}
        </Text>
        {sessions.map((s, i) => {
          const start = Date.parse(s.starts_at);
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={t("schedule.needsAnswerLabel", { title: nameOf(s) })}
              onPress={() => onOpen(s.id)}
              style={[styles.row, i > 0 && { borderTopWidth: 1, borderColor: colors.border }]}
            >
              <View style={styles.text}>
                <Text variant="rowName">{nameOf(s)}</Text>
                <Text variant="label" color="textMuted">
                  {`${formatDay(startOfDay(start, timeZone), now, timeZone, t)} · ${formatTime(start, timeZone, t.locale)}`}
                </Text>
              </View>
              <Text variant="title" color="textMuted">
                ›
              </Text>
            </Pressable>
          );
        })}
        {more > 0 && (
          <Text variant="label" color="textMuted" style={styles.more}>
            {t("schedule.needsAnswerMore", { count: more })}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: radius.lg - 4, borderWidth: 1, overflow: "hidden" },
  edge: { width: 4 },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.md },
  title: { paddingBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm },
  text: { flex: 1 },
  more: { paddingBottom: space.md },
});
