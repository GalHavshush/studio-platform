import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { Button } from "@/components/button";
import { CoachNoteCard, NextClassCard } from "@/components/home-cards";
import { NeedsAnswerCard } from "@/components/needs-answer-card";
import { Screen } from "@/components/screen";
import { StudioMark } from "@/components/studio-badge";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { latestCoachNote, nextClasses } from "@/schedule/home";
import { needsAnswer } from "@/schedule/needs-answer";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { useNow } from "@/schedule/use-now";
import { useSchedule, type ScheduledSession } from "@/schedule/use-schedule";
import { useTimeline } from "@/schedule/use-timeline";
import { useWeekStart } from "@/schedule/use-week-start";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The member's first page: what needs an answer, what is coming and the latest word from a coach.
export default function Home() {
  const { studio: current, user } = useSession();
  const studio = current as Studio;
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { firstDay } = useWeekStart();
  const schedule = useSchedule(studio.timezone, firstDay);
  const timeline = useTimeline(studio.participantId as string);
  const now = useNow(60_000);
  const zone = studio.timezone;

  const answer = useMemo(() => needsAnswer(schedule.all, now), [schedule.all, now]);
  const next = useMemo(() => nextClasses(schedule.all, now), [schedule.all, now]);
  const coachNote = useMemo(
    () => (timeline.status === "ready" ? latestCoachNote(timeline.items, now) : null),
    [timeline, now],
  );

  const open = (id: string) => router.push({ pathname: "/session/[id]", params: { id } });
  const nameOf = (s: ScheduledSession) => schedule.classTypeNames[s.class_type_id] ?? t("schedule.classFallback");
  const dayOf = (at: number) => formatDay(startOfDay(at, zone), now, zone, t);
  const tagOf = (rsvp: string | null) => (rsvp === "waitlist" ? t("home.waiting") : t(rsvp === "maybe" ? "rsvp.maybe" : "rsvp.going"));
  const nothing = schedule.status === "ready" && answer.shown.length === 0 && next.length === 0 && !coachNote;

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <StudioMark name={studio.name} size={48} />
        <View style={styles.titles}>
          <Text variant="pageTitle" numberOfLines={1}>
            {studio.name}
          </Text>
          {user && (
            <Text variant="label" color="textMuted">
              {t("home.hi", { name: user.name.split(" ")[0] })}
            </Text>
          )}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}
        refreshControl={<RefreshControl refreshing={schedule.busy === "refresh"} onRefresh={() => { schedule.refresh(); timeline.refresh(); }} />}
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
        {answer.shown.length > 0 && (
          <NeedsAnswerCard sessions={answer.shown} more={answer.more} nameOf={nameOf} timeZone={zone} now={now} onOpen={open} />
        )}
        {next.length > 0 && (
          <View style={styles.section}>
            <Text variant="eyebrow" color="textMuted">
              {t("home.nextClasses")}
            </Text>
            {next.map((s) => {
              const at = Date.parse(s.starts_at);
              return (
                <NextClassCard
                  key={s.id}
                  time={formatTime(at, zone, t.locale)}
                  title={nameOf(s)}
                  day={dayOf(at)}
                  tag={tagOf(s.my_rsvp)}
                  label={t("schedule.needsAnswerLabel", { title: nameOf(s) })}
                  onPress={() => open(s.id)}
                />
              );
            })}
          </View>
        )}
        {coachNote && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text variant="eyebrow" color="textMuted">
                {t("home.fromCoaches")}
              </Text>
              <Button variant="link" title={t("home.all")} onPress={() => router.navigate("/timeline")} />
            </View>
            <CoachNoteCard
              when={`${coachNote.entry.class_type_name} · ${dayOf(Date.parse(coachNote.entry.starts_at))}`}
              tag={t("home.noteTag")}
              body={coachNote.note.body}
              label={coachNote.entry.class_type_name}
              onPress={() => router.push({ pathname: "/session/summary/[id]", params: { id: coachNote.entry.session_id } })}
            />
          </View>
        )}
        {nothing && <Text color="textMuted">{t("home.nothing")}</Text>}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.md },
  titles: { flex: 1 },
  body: { padding: space.xl, paddingTop: space.md, gap: space.xl },
  section: { gap: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { alignItems: "center", gap: space.sm },
});
