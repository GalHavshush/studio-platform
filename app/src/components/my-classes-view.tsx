import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { ClassList, DateRow } from "@/components/class-list";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Screen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { StudioBadge } from "@/components/studio-badge";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { Tile } from "@/components/tile";
import { useT } from "@/i18n/use-language";
import { groupPast, monthStats, pastLine, splitByNow } from "@/schedule/my-classes";
import { planLabel } from "@/schedule/plan";
import { entryStatus, sharedNotes, statusLabel, type TimelineEntry } from "@/schedule/timeline";
import { useNow } from "@/schedule/use-now";
import { useTimeline } from "@/schedule/use-timeline";
import { useWeekStart } from "@/schedule/use-week-start";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Tab = "upcoming" | "past";

// The member's own classes tab: this month in two numbers, then what is coming and what has been.
// `header` (the staff's reports to write) sits on top, whatever state the timeline is in.
export function MyClassesView({ id, header }: { id: string; header?: ReactNode }) {
  const studio = useSession().studio as Studio;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { firstDay } = useWeekStart();
  const timeline = useTimeline(id);
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>("past");
  const zone = studio.timezone;
  const items = timeline.status === "ready" ? timeline.items : undefined;

  const { upcoming, past } = useMemo(() => splitByNow(items ?? [], now), [items, now]);
  const groups = useMemo(() => groupPast(past, now, zone, firstDay, t), [past, now, zone, firstDay, t]);
  const stats = monthStats(items ?? [], now, zone);
  const month = new Intl.DateTimeFormat(t.locale, { timeZone: zone, month: "long" }).format(new Date(now));

  const row = (e: TimelineEntry, line: string | null, tag: ReactNode, open: () => void) => {
    const at = Date.parse(e.starts_at);
    const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(t.locale, { timeZone: zone, ...o }).format(at);
    return (
      <DateRow
        key={e.session_id}
        day={part({ day: "numeric" })}
        weekday={part({ weekday: "short" })}
        title={e.class_type_name}
        line={line}
        tag={tag}
        label={`${e.class_type_name}, ${part({ weekday: "long", day: "numeric", month: "long" })}`}
        onPress={open}
      />
    );
  };
  const pastRow = (e: TimelineEntry) => {
    const status = entryStatus(e, now);
    const tag =
      sharedNotes(e).length > 0 ? (
        <Pill label={t("myClasses.noteTag")} tone="accent" />
      ) : (
        <Pill label={statusLabel(t, status)} tone={status === "cancelled" ? "ink" : status === "attended" ? "soft" : "outline"} />
      );
    return row(e, pastLine(t, e), tag, () => router.push({ pathname: "/session/summary/[id]", params: { id: e.session_id } }));
  };
  const upcomingRow = (e: TimelineEntry) =>
    row(
      e,
      e.booking ? planLabel(t, e.booking) : null,
      e.status === "cancelled" ? <Pill label={statusLabel(t, "cancelled")} tone="ink" /> : null,
      () => router.push({ pathname: "/session/[id]", params: { id: e.session_id } }),
    );

  return (
    <Screen>
      <PageHeader title={t("tabs.timeline")} tag={<StudioBadge />} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}>
        {header}
        {timeline.status === "loading" && <ActivityIndicator color={colors.textMuted} />}
        {timeline.status === "error" && (
          <View style={styles.center}>
            <Text color="danger" accessibilityRole="alert">
              {t("timeline.loadError")}
            </Text>
            <Button variant="link" title={t("common.tryAgain")} onPress={timeline.retry} />
          </View>
        )}
        {timeline.status === "notFound" && <Text color="textMuted">{t("timeline.notAvailable")}</Text>}
        {timeline.status === "ready" && (
          <>
            <View style={styles.tiles}>
              <Tile figure label={t("myClasses.attendedIn", { month })} value={String(stats.attended)} />
              <Tile figure label={t("myClasses.notesFromCoaches")} value={String(stats.notes)} />
            </View>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "upcoming", label: t("myClasses.upcoming") },
                { value: "past", label: t("myClasses.past") },
              ]}
            />
            {tab === "upcoming" ? (
              upcoming.length === 0 ? (
                <Text color="textMuted">{t("myClasses.noUpcoming")}</Text>
              ) : (
                <ClassList>{upcoming.map(upcomingRow)}</ClassList>
              )
            ) : groups.length === 0 ? (
              <Text color="textMuted">{t("myClasses.noPast")}</Text>
            ) : (
              groups.map((g) => (
                <View key={g.key} style={styles.group}>
                  <Text variant="eyebrow" color="textMuted">
                    {g.label}
                  </Text>
                  <ClassList>{g.entries.map(pastRow)}</ClassList>
                </View>
              ))
            )}
            {timeline.next && tab === "past" && (
              <View style={styles.center}>
                {timeline.more === "failed" && (
                  <Text color="danger" accessibilityRole="alert">
                    {t("timeline.moreError")}
                  </Text>
                )}
                <Button variant="outline" title={t("schedule.showEarlier")} busy={timeline.more === "busy"} onPress={timeline.showMore} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, gap: space.xl },
  tiles: { flexDirection: "row", gap: space.md },
  group: { gap: space.sm },
  center: { alignItems: "center", gap: space.sm },
});
