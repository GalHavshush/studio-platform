import { useRouter } from "expo-router";
import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSession, type Studio } from "@/auth/session";
import { useSchedule, type ScheduledSession } from "@/schedule/use-schedule";
import { dayKey, formatDay, formatTime, startOfDay } from "@/schedule/time";

type Day = { key: string; title: string; data: ScheduledSession[] };

// Sessions are already in time order, so a day is a run of neighbours with the same local date.
function groupByDay(sessions: ScheduledSession[], timeZone: string): Day[] {
  const now = Date.now();
  const days: Day[] = [];
  for (const s of sessions) {
    const at = Date.parse(s.starts_at);
    const key = dayKey(at, timeZone);
    const last = days[days.length - 1];
    if (last?.key === key) last.data.push(s);
    else days.push({ key, title: formatDay(startOfDay(at, timeZone), now, timeZone), data: [s] });
  }
  return days;
}

export default function Home() {
  const { studio, user, leaveStudio, signOut } = useSession();
  // The guard in the layout only shows this screen when a studio is chosen.
  return <Schedule studio={studio as Studio} canSwitch={(user?.memberships.length ?? 0) > 1} onSwitch={leaveStudio} onSignOut={signOut} />;
}

function Schedule(props: { studio: Studio; canSwitch: boolean; onSwitch: () => void; onSignOut: () => void }) {
  const { studio } = props;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const schedule = useSchedule(studio.timezone);
  const days = useMemo(
    () => groupByDay(schedule.sessions, studio.timezone),
    [schedule.sessions, studio.timezone],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.studio}>{studio.name}</Text>
        <Text>Your role: {studio.role}</Text>
        <View style={styles.links}>
          {props.canSwitch && (
            <Pressable onPress={props.onSwitch}>
              <Text style={styles.link}>Switch studio</Text>
            </Pressable>
          )}
          <Pressable onPress={props.onSignOut}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {schedule.status === "loading" && <ActivityIndicator style={styles.center} />}
      {schedule.status === "error" && (
        <View style={styles.center}>
          <Text style={styles.error}>Couldn't load the schedule.</Text>
          <Pressable onPress={schedule.refresh}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      )}
      {schedule.status === "ready" && (
        <SectionList
          sections={days}
          keyExtractor={(s) => s.id}
          refreshControl={
            <RefreshControl refreshing={schedule.busy === "refresh"} onRefresh={schedule.refresh} />
          }
          ListHeaderComponent={
            <MoreButton
              label="Show earlier"
              busy={schedule.busy === "earlier"}
              onPress={schedule.showEarlier}
            />
          }
          ListFooterComponent={
            <View>
              {schedule.error && <Text style={styles.error}>Couldn't load. Try again.</Text>}
              <MoreButton
                label="Show later"
                busy={schedule.busy === "later"}
                onPress={schedule.showLater}
              />
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No sessions in this period.</Text>}
          renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: item.id } })}
            >
              <Text style={styles.time}>{formatTime(Date.parse(item.starts_at), studio.timezone)}</Text>
              <Text style={[styles.name, item.status === "cancelled" && styles.cancelled]}>
                {schedule.classTypeNames[item.class_type_id] ?? "Class"}
              </Text>
              {item.status === "cancelled" && <Text style={styles.badge}>cancelled</Text>}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function MoreButton(props: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.more} onPress={props.onPress} disabled={props.busy}>
      {props.busy ? <ActivityIndicator /> : <Text style={styles.link}>{props.label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#999" },
  studio: { fontSize: 20, fontWeight: "600" },
  links: { flexDirection: "row", gap: 16, marginTop: 4 },
  link: { color: "#208AEF", fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  error: { color: "#B00020", textAlign: "center", padding: 8 },
  empty: { textAlign: "center", padding: 24 },
  more: { padding: 16, alignItems: "center" },
  day: { fontSize: 16, fontWeight: "600", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, backgroundColor: "#f2f2f2", color: "#222" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  time: { fontVariant: ["tabular-nums"], fontSize: 16, width: 52 },
  name: { fontSize: 16, flexShrink: 1 },
  cancelled: { textDecorationLine: "line-through", color: "#777" },
  badge: { fontSize: 12, color: "#B00020" },
});
