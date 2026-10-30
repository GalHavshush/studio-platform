import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { TimelineCard } from "@/components/timeline-card";
import { HistoryRow } from "@/components/history-row";
import { useT } from "@/i18n/use-language";
import { useWeekStart } from "@/schedule/use-week-start";
import { aboutYou } from "@/schedule/timeline";
import { useTimeline } from "@/schedule/use-timeline";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  id: string;
  // only shown (staff opening someone else's timeline); the id alone decides what loads
  name?: string;
  // true when this is the member's own timeline in the tab bar: no back button, room for the bar
  tab?: boolean;
  // shown above the timeline (the staff's reports to write), whatever state the timeline is in
  header?: ReactNode;
};

// A person's classes, newest first. Used as the "Timeline" tab (your own) and as a screen above the
// tabs (staff opening someone else's).
export function TimelineView({ id, name, tab = false, header }: Props) {
  const { studio } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const timeline = useTimeline(id);
  // ponytail: read once when the screen opens; "upcoming" and "no record" are judged against it.
  const [now] = useState(Date.now);
  const { firstDay } = useWeekStart();
  const [open, setOpen] = useState<string | null>(null); // the history row whose card is shown
  const zone = studio?.timezone ?? "UTC";

  // ponytail: judged on the pages loaded so far (20 classes, newest first); a member with more than that
  // many upcoming classes would not see last week's reports until "Show earlier".
  // On the tab (your own classes) last week's reports are lifted out of the list, which keeps the rest
  // as a compact history. Someone else's timeline stays the plain list of full cards.
  const items = timeline.status === "ready" && studio ? timeline.items : [];
  const about = tab ? aboutYou(items, now, zone, firstDay) : [];
  const aboutIds = new Set(about.map((e) => e.session_id));
  const rest = tab ? items.filter((e) => !aboutIds.has(e.session_id)) : items;
  const ready = tab && timeline.status === "ready";

  return (
    <Screen>
      <PageHeader title={tab ? t("tabs.timeline") : t("timeline.title")} subtitle={name} backLabel={tab ? undefined : t("timeline.back")} />

      {/* One list, always mounted: the header (reports to write) must not remount when the timeline
          finishes loading, or it would reload and lose the weeks "Show earlier" added. */}
      <FlatList
        data={rest}
        keyExtractor={(e) => e.session_id}
        contentContainerStyle={{
          padding: space.xl,
          paddingBottom: insets.bottom + space.xl + (tab ? TAB_BAR_SPACE : 0),
        }}
        ListHeaderComponent={
          header || ready ? (
            <View style={styles.headerGap}>
              {header}
              {ready && (
                <View style={styles.section}>
                  <Text variant="title">{t("about.title")}</Text>
                  {about.length === 0 && <Text color="textMuted">{t("about.none")}</Text>}
                  {about.map((e) => (
                    <TimelineCard key={e.session_id} entry={e} timeZone={zone} now={now} />
                  ))}
                  {rest.length > 0 && <Text variant="title">{t("history.title")}</Text>}
                </View>
              )}
            </View>
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) =>
          tab ? (
            <HistoryRow
              entry={item}
              timeZone={zone}
              now={now}
              open={open === item.session_id}
              onToggle={() => setOpen(open === item.session_id ? null : item.session_id)}
            />
          ) : (
            <TimelineCard entry={item} timeZone={zone} now={now} />
          )
        }
        ListEmptyComponent={
          timeline.status === "loading" ? (
            <ActivityIndicator style={styles.empty} color={colors.textMuted} />
          ) : timeline.status === "notFound" ? (
            <Text style={styles.empty}>{t("timeline.notAvailable")}</Text>
          ) : timeline.status === "error" ? (
            <View style={styles.center}>
              <Text color="danger" accessibilityRole="alert">
                {t("timeline.loadError")}
              </Text>
              <Button variant="link" title={t("common.tryAgain")} onPress={timeline.retry} />
            </View>
          ) : (
            <Text color="textMuted" style={styles.empty}>
              {t("timeline.empty")}
            </Text>
          )
        }
        ListFooterComponent={
          timeline.status === "ready" && timeline.next ? (
            <View style={styles.footer}>
              {timeline.more === "failed" && (
                <Text color="danger" accessibilityRole="alert">
                  {t("timeline.moreError")}
                </Text>
              )}
              <Button
                variant="outline"
                title={t("schedule.showEarlier")}
                busy={timeline.more === "busy"}
                onPress={timeline.showMore}
              />
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, padding: space.xl },
  gap: { height: space.md },
  headerGap: { gap: space.xl, paddingBottom: space.xl },
  section: { gap: space.md },
  empty: { textAlign: "center", padding: space.xl },
  footer: { alignItems: "center", gap: space.sm, paddingTop: space.lg },
});
