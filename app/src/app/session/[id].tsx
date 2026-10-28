import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";
import { formatRange } from "@/schedule/time";
import { useSessionDetail, type SessionDetail } from "@/schedule/use-session";

// What the server's RSVP status means to a person. null: they have not answered.
const PLAN: Record<string, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Not going",
  waitlist: "On the waiting list",
};

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studio } = useSession();
  const detail = useSessionDetail(id);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: detail.status === "ready" ? detail.session.class_type_name : "Session" }} />
      {detail.status === "loading" && <ActivityIndicator style={styles.center} />}
      {detail.status === "notFound" && (
        <View style={styles.center}>
          <Text>This session isn't available.</Text>
        </View>
      )}
      {detail.status === "error" && (
        <View style={styles.center}>
          <Text style={styles.error}>Couldn't load the session.</Text>
          <Pressable onPress={detail.retry}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      )}
      {detail.status === "ready" && studio && (
        <Details session={detail.session} timeZone={studio.timezone} />
      )}
    </View>
  );
}

function Details({ session, timeZone }: { session: SessionDetail; timeZone: string }) {
  const counts = session.rsvp_counts;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.details}>
      <Text style={styles.title}>{session.class_type_name}</Text>
      {session.status === "cancelled" && <Text style={styles.cancelled}>Cancelled</Text>}
      <Text style={styles.when}>
        {formatRange(Date.parse(session.starts_at), Date.parse(session.ends_at), timeZone)}
      </Text>
      <Text>Coach: {session.coach_name}</Text>
      {session.capacity !== null && <Text>Capacity: {session.capacity}</Text>}
      {session.preview && <Text style={styles.preview}>{session.preview}</Text>}
      <Text style={styles.plan}>
        Your plan: {session.my_rsvp ? PLAN[session.my_rsvp] ?? session.my_rsvp : "not answered"}
      </Text>
      {counts && (
        <Text>
          {counts.going} going · {counts.maybe} maybe · {counts.not_going} not going ·{" "}
          {counts.waitlist} waiting
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  details: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: "600" },
  cancelled: { color: "#B00020", fontWeight: "600" },
  when: { fontSize: 16 },
  preview: { marginTop: 8 },
  plan: { marginTop: 12, fontWeight: "600" },
  error: { color: "#B00020" },
  link: { color: "#208AEF", fontSize: 16 },
});
