import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Row } from "@/components/row";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { TodayCard, TodayRow } from "@/components/today-card";
import { WeekStrip } from "@/components/week-strip";
import { StudioBadge } from "@/components/studio-badge";
import { Text } from "@/components/text";
import { isStaff } from "@/auth/role";
import { useSession, type Studio } from "@/auth/session";
import { useT } from "@/i18n/use-language";
import type { Translator } from "@/i18n/translate";
import { chipTone } from "@/schedule/chip";
import { useSchedule, type ScheduledSession } from "@/schedule/use-schedule";
import { dayKey, formatDay, formatTime, startOfDay } from "@/schedule/time";
import { useNow } from "@/schedule/use-now";
import { useWeekStart } from "@/schedule/use-week-start";
import { dayDate, todayStates, weekDays, weekRange } from "@/schedule/week";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Day = { key: string; title: string; data: ScheduledSession[] };

// Sessions are already in time order, so a day is a run of neighbours with the same local date.
function groupByDay(sessions: ScheduledSession[], timeZone: string, t: Translator): Day[] {
  const now = Date.now();
  const days: Day[] = [];
  for (const s of sessions) {
    const at = Date.parse(s.starts_at);
    const key = dayKey(at, timeZone);
    const last = days[days.length - 1];
    if (last?.key === key) last.data.push(s);
    else days.push({ key, title: formatDay(startOfDay(at, timeZone), now, timeZone, t), data: [s] });
  }
  return days;
}

// Today is always on the screen, even with no classes, so the page keeps its focus.
function withToday(days: Day[], now: number, timeZone: string, t: Translator): Day[] {
  const key = dayKey(now, timeZone);
  if (days.some((d) => d.key === key)) return days;
  const today = { key, title: formatDay(startOfDay(now, timeZone), now, timeZone, t), data: [] };
  const at = days.findIndex((d) => d.key > key);
  return at === -1 ? [...days, today] : [...days.slice(0, at), today, ...days.slice(at)];
}

export default function Schedule() {
  // The guard in the layout only shows this screen when a studio is chosen.
  const studio = useSession().studio as Studio;
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { firstDay } = useWeekStart();
  const schedule = useSchedule(studio.timezone, firstDay);
  const now = useNow(60_000); // "done" and "next" move on by themselves
  const zone = studio.timezone;
  const todayKey = dayKey(now, zone);
  const days = useMemo(
    () => withToday(groupByDay(schedule.sessions, zone, t), now, zone, t),
    [schedule.sessions, zone, t, now],
  );
  const strip = useMemo(() => {
    const withClasses = new Set(schedule.all.map((s) => dayKey(Date.parse(s.starts_at), zone)));
    return weekDays(now, zone, t.locale, firstDay).map((d) => ({
      key: d.key,
      letter: d.letter,
      number: d.number,
      label: d.label,
      today: d.key === todayKey,
      past: d.key < todayKey,
      hasClasses: withClasses.has(d.key),
    }));
  }, [schedule.all, now, zone, t.locale, todayKey, firstDay]);

  const open = (id: string) => router.push({ pathname: "/session/[id]", params: { id } });
  const nameOf = (s: ScheduledSession) => schedule.classTypeNames[s.class_type_id] ?? t("schedule.classFallback");
  const timeOf = (s: ScheduledSession) => formatTime(Date.parse(s.starts_at), zone, t.locale);

  function renderDay(day: Day) {
    if (day.key === todayKey) {
      const states = todayStates(day.data, now);
      return (
        <TodayCard title={day.title} date={dayDate(now, zone, t.locale)}>
          {day.data.length === 0 && (
            <Text color="textMuted" style={styles.nothing}>
              {t("schedule.nothingToday")}
            </Text>
          )}
          {day.data.map((s) => (
            <TodayRow
              key={s.id}
              time={timeOf(s)}
              title={nameOf(s)}
              state={states.get(s.id)}
              cancelled={s.status === "cancelled"}
              onPress={() => open(s.id)}
            />
          ))}
        </TodayCard>
      );
    }
    return (
      <View style={day.key < todayKey && styles.past}>
        <Text variant="eyebrow" style={styles.day}>
          {day.title}
        </Text>
        <View style={styles.gap}>
          {day.data.map((s) => (
            <Row
              key={s.id}
              time={timeOf(s)}
              title={nameOf(s)}
              tone={chipTone(s.class_type_id)}
              cancelled={s.status === "cancelled"}
              onPress={() => open(s.id)}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <PageHeader title={t("tabs.schedule")} tag={<StudioBadge />} />

      {schedule.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {schedule.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("schedule.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={schedule.refresh} />
        </View>
      )}
      {schedule.status === "ready" && (
        <FlatList
          data={days}
          keyExtractor={(d) => d.key}
          contentContainerStyle={{
            paddingHorizontal: space.xl,
            paddingTop: space.lg,
            paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE,
          }}
          ItemSeparatorComponent={() => <View style={styles.between} />}
          refreshControl={
            <RefreshControl refreshing={schedule.busy === "refresh"} onRefresh={schedule.refresh} />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              {isStaff(studio.role) && (
                <Button variant="outline" title={t("schedule.newClass")} onPress={() => router.push("/session/new")} />
              )}
              <WeekStrip title={t("schedule.thisWeek")} range={weekRange(now, zone, t.locale, firstDay)} days={strip} />
              <Button
                variant="outline"
                title={t("schedule.showEarlier")}
                busy={schedule.busy === "earlier"}
                onPress={schedule.showEarlier}
              />
            </View>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {schedule.error && (
                <Text color="danger" accessibilityRole="alert">
                  {t("schedule.loadMoreError")}
                </Text>
              )}
              <Button
                variant="outline"
                title={t("schedule.showLater")}
                busy={schedule.busy === "later"}
                onPress={schedule.showLater}
              />
            </View>
          }
          renderItem={({ item }) => renderDay(item)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  header: { gap: space.lg, paddingBottom: space.sm },
  between: { height: space.sm },
  gap: { gap: space.sm },
  footer: { gap: space.sm, paddingTop: space.lg },
  nothing: { paddingHorizontal: space.xs, paddingBottom: space.lg },
  past: { opacity: 0.6 },
  day: { paddingTop: space.lg, paddingBottom: space.sm },
});
