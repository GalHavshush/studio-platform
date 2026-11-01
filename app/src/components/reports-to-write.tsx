import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { ClassRow } from "@/components/class-row";
import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { useReportQueue } from "@/schedule/use-report-queue";
import { useWeekStart } from "@/schedule/use-week-start";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { useNow } from "@/schedule/use-now";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The staff's classes that took place, either still to write or already written, this week first.
// With a `limit` it is a short list (the coach's Today) without "Show earlier".
export function ReportsToWrite({ written = false, limit }: { written?: boolean; limit?: number }) {
  const { studio } = useSession();
  const { firstDay } = useWeekStart();
  const { colors } = useTheme();
  const router = useRouter();
  const t = useT();
  const zone = studio?.timezone ?? "UTC";
  const queue = useReportQueue(zone, firstDay);
  const now = useNow(60_000);
  const items = queue.items.filter((i) => i.has_report === written);
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <View style={styles.wrap}>
      {queue.status === "loading" && <ActivityIndicator color={colors.textMuted} />}
      {queue.status === "error" && (
        <View style={styles.gap}>
          <Text color="danger" accessibilityRole="alert">
            {t("reports.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={queue.retry} />
        </View>
      )}
      {queue.status === "ready" && (
        <>
          {shown.length === 0 && <Text color="textMuted">{t(written ? "reports.noneWritten" : "reports.allDone")}</Text>}
          {shown.map((i) => {
            const start = Date.parse(i.starts_at);
            const when = `${formatDay(startOfDay(start, zone), now, zone, t)} · ${formatTime(start, zone, t.locale)}`;
            return (
              <ClassRow
                key={i.session_id}
                when={when}
                title={i.class_type_name}
                tag={i.has_report ? <Pill label={t("reports.written")} tone="ink" /> : <Pill label={t("reports.toWrite")} />}
                label={t("reports.rowLabel", { title: i.class_type_name, when })}
                onPress={() => router.push({ pathname: "/session/report/[id]", params: { id: i.session_id } })}
              />
            );
          })}
          {!limit && queue.more === "failed" && (
            <Text color="danger" accessibilityRole="alert">
              {t("timeline.moreError")}
            </Text>
          )}
          {!limit && queue.hasEarlier && (
            <Button
              variant="outline"
              title={t("schedule.showEarlier")}
              busy={queue.more === "busy"}
              onPress={queue.showEarlier}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  gap: { gap: space.sm },
});
