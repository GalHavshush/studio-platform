import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountSheet } from "@/components/account-sheet";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Pill } from "@/components/pill";
import { Row } from "@/components/row";
import { Hero, Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { roleLabel } from "@/auth/role";
import { useSession, type Studio } from "@/auth/session";
import { useT } from "@/i18n/use-language";
import type { Translator } from "@/i18n/translate";
import { chipTone } from "@/schedule/chip";
import { useSchedule, type ScheduledSession } from "@/schedule/use-schedule";
import { dayKey, formatDay, formatTime, startOfDay } from "@/schedule/time";
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

export default function Home() {
  const { studio, user, leaveStudio, signOut } = useSession();
  // The guard in the layout only shows this screen when a studio is chosen.
  return (
    <Schedule
      studio={studio as Studio}
      initial={user?.name.charAt(0).toUpperCase() || "?"}
      canSwitch={(user?.memberships.length ?? 0) > 1}
      onSwitch={leaveStudio}
      onSignOut={signOut}
    />
  );
}

type Props = {
  studio: Studio;
  initial: string;
  canSwitch: boolean;
  onSwitch: () => void;
  onSignOut: () => void;
};

function Schedule(props: Props) {
  const { studio } = props;
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const schedule = useSchedule(studio.timezone);
  const [menuOpen, setMenuOpen] = useState(false);
  const days = useMemo(
    () => groupByDay(schedule.sessions, studio.timezone, t),
    [schedule.sessions, studio.timezone, t],
  );

  return (
    <Screen>
      <Hero compact>
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("schedule.accountMenu")}
            onPress={() => setMenuOpen(true)}
            style={[styles.avatar, { backgroundColor: colors.primary }]}
          >
            <Text variant="title" color="soft">
              {props.initial}
            </Text>
          </Pressable>
          <Logo size={64} />
        </View>
        <View style={styles.titles}>
          <Pill label={roleLabel(t, studio.role)} tone="ink" />
          <Text variant="heading" color="onAccent">
            {studio.name}
          </Text>
        </View>
      </Hero>

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
        <SectionList
          sections={days}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{
            paddingHorizontal: space.xl,
            paddingTop: space.lg,
            paddingBottom: insets.bottom + space.xl,
          }}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          refreshControl={
            <RefreshControl refreshing={schedule.busy === "refresh"} onRefresh={schedule.refresh} />
          }
          ListHeaderComponent={
            <Button
              variant="outline"
              title={t("schedule.showEarlier")}
              busy={schedule.busy === "earlier"}
              onPress={schedule.showEarlier}
            />
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
          ListEmptyComponent={
            <Text color="textMuted" style={styles.empty}>
              {t("schedule.empty")}
            </Text>
          }
          renderSectionHeader={({ section }) => (
            <Text variant="eyebrow" style={styles.day}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <Row
              time={formatTime(Date.parse(item.starts_at), studio.timezone, t.locale)}
              title={schedule.classTypeNames[item.class_type_id] ?? t("schedule.classFallback")}
              tone={chipTone(item.class_type_id)}
              cancelled={item.status === "cancelled"}
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: item.id } })}
            />
          )}
          stickySectionHeadersEnabled={false}
        />
      )}

      <AccountSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSwitchStudio={props.canSwitch ? props.onSwitch : undefined}
        onSignOut={props.onSignOut}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  titles: { gap: space.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  gap: { height: space.sm },
  footer: { gap: space.sm, paddingTop: space.lg },
  empty: { textAlign: "center", padding: space.xl },
  day: { paddingTop: space.xl, paddingBottom: space.sm },
});
