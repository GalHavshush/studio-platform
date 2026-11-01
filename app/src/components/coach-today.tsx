import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { HomeHeader } from "@/components/home-header";
import { NextClassCard, NextUpCard } from "@/components/home-cards";
import { ReportsToWrite } from "@/components/reports-to-write";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { minutesUntil, REPORTS_ON_TODAY, splitToday, todaysClasses } from "@/schedule/coach-today";
import { formatTime } from "@/schedule/time";
import { useCounts } from "@/schedule/use-counts";
import { useNow } from "@/schedule/use-now";
import { useSchedule, type ScheduledSession } from "@/schedule/use-schedule";
import { useWeekStart } from "@/schedule/use-week-start";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The coach's first page: the next class with who is coming, the rest of today and the reports to write.
export function CoachToday() {
  const { studio: current, user } = useSession();
  const studio = current as Studio;
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { firstDay } = useWeekStart();
  const schedule = useSchedule(studio.timezone, firstDay);
  const now = useNow(60_000);
  const zone = studio.timezone;

  const { next, later } = useMemo(
    () => splitToday(todaysClasses(schedule.all, user?.id ?? "", now, zone), now),
    [schedule.all, user?.id, now, zone],
  );
  const { counts, refresh } = useCounts([next, ...later].flatMap((s) => (s ? [s.id] : [])));

  const open = (id: string) => router.push({ pathname: "/session/[id]", params: { id } });
  const nameOf = (s: ScheduledSession) => schedule.classTypeNames[s.class_type_id] ?? t("schedule.classFallback");
  const timeOf = (s: ScheduledSession) => formatTime(Date.parse(s.starts_at), zone, t.locale);
  const minutes = (s: ScheduledSession) => Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000);
  const goingLine = (s: ScheduledSession) => {
    const c = counts[s.id];
    if (!c) return t("coach.minutes", { n: minutes(s) });
    return s.capacity === null
      ? t("coach.goingOnly", { going: c.going })
      : t("coach.goingOf", { going: c.going, capacity: s.capacity });
  };
  const whenOf = (s: ScheduledSession) => {
    const n = minutesUntil(s.starts_at, now);
    return n === 0 ? t("coach.now") : n < 60 ? t("coach.inMin", { n }) : t("coach.nextUp");
  };
  const figures = (id: string) => {
    const c = counts[id];
    return c
      ? [
          { value: String(c.going), label: t("coach.going") },
          { value: String(c.maybe), label: t("coach.maybe") },
          { value: String(c.waitlist), label: t("coach.waiting") },
        ]
      : [];
  };

  return (
    <Screen>
      <HomeHeader />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}
        refreshControl={
          <RefreshControl
            refreshing={schedule.busy === "refresh"}
            onRefresh={() => {
              schedule.refresh();
              refresh();
            }}
          />
        }
      >
        {schedule.status === "loading" && <ActivityIndicator color={colors.textMuted} />}
        {schedule.status === "error" && (
          <View style={styles.center}>
            <Text color="danger" accessibilityRole="alert">
              {t("schedule.loadError")}
            </Text>
            <Button variant="link" title={t("common.tryAgain")} onPress={schedule.refresh} />
          </View>
        )}
        {schedule.status === "ready" && !next && <Text color="textMuted">{t("coach.nothingToday")}</Text>}
        {next && (
          <NextUpCard
            when={whenOf(next)}
            time={timeOf(next)}
            title={nameOf(next)}
            meta={t("coach.minutes", { n: minutes(next) })}
            counts={figures(next.id)}
            whoLabel={t("coach.who")}
            attendanceLabel={t("coach.attendance")}
            onOpen={() => open(next.id)}
          />
        )}
        {later.length > 0 && (
          <View style={styles.section}>
            <Text variant="eyebrow" color="textMuted">
              {t("coach.later")}
            </Text>
            {later.map((s) => (
              <NextClassCard
                key={s.id}
                time={timeOf(s)}
                title={nameOf(s)}
                day={goingLine(s)}
                label={t("coach.rowLabel", { title: nameOf(s), time: timeOf(s) })}
                onPress={() => open(s.id)}
              />
            ))}
          </View>
        )}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text variant="eyebrow" color="textMuted">
              {t("reports.title")}
            </Text>
            <Button variant="link" title={t("reports.all")} onPress={() => router.navigate("/reports")} />
          </View>
          <ReportsToWrite limit={REPORTS_ON_TODAY} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.md, gap: space.xl },
  section: { gap: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { alignItems: "center", gap: space.sm },
});
