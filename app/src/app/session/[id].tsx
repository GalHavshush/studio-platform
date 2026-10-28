import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSession } from "@/auth/session";
import {
  CHOICES,
  confirmation,
  outcomeMessage,
  planLabel,
  seatsText,
  selectedChoice,
  type Choice,
  type RsvpOutcome,
} from "@/schedule/plan";
import { formatRange } from "@/schedule/time";
import { useSessionDetail, type SessionDetail } from "@/schedule/use-session";

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
        <Details
          session={detail.session}
          stale={detail.stale}
          timeZone={studio.timezone}
          rsvp={detail.rsvp}
        />
      )}
    </View>
  );
}

type DetailsProps = {
  session: SessionDetail;
  stale: boolean;
  timeZone: string;
  rsvp: (choice: Choice) => Promise<RsvpOutcome>;
};

function Details({ session, stale, timeZone, rsvp }: DetailsProps) {
  const counts = session.rsvp_counts;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = session.status === "cancelled";
  const seats = seatsText(session.seats_left, session.my_rsvp);
  const selected = selectedChoice(session.my_rsvp);

  async function send(choice: Choice) {
    setSaving(true);
    setMessage(null);
    const outcome = await rsvp(choice);
    setSaving(false);
    setMessage(outcomeMessage(outcome));
  }

  function choose(choice: Choice) {
    if (saving || cancelled || choice === selected) return; // nothing to change
    if (session.attendance_mode !== "booking") return void send(choice);
    // A booking class: the answer can cost or free a seat, so ask first. Nothing is sent until yes.
    const ask = confirmation(choice, session.my_rsvp, session.seats_left);
    Alert.alert(ask.title, ask.message, [
      { text: "Cancel", style: "cancel" },
      { text: ask.confirm, onPress: () => void send(choice) },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.details}>
      <Text style={styles.title}>{session.class_type_name}</Text>
      {cancelled && <Text style={styles.cancelled}>Cancelled</Text>}
      <Text style={styles.when}>
        {formatRange(Date.parse(session.starts_at), Date.parse(session.ends_at), timeZone)}
      </Text>
      <Text>Coach: {session.coach_name}</Text>
      {session.capacity !== null && <Text>Capacity: {session.capacity}</Text>}
      {seats && <Text style={styles.seats}>{seats}</Text>}
      {session.preview && <Text style={styles.preview}>{session.preview}</Text>}
      <Text style={styles.plan}>Your plan: {planLabel(session.my_rsvp)}</Text>
      <View style={styles.choices}>
        {CHOICES.map((c) => (
          <Pressable
            key={c.value}
            disabled={saving || cancelled}
            onPress={() => choose(c.value)}
            style={[
              styles.choice,
              c.value === selected && styles.chosen,
              (saving || cancelled) && styles.disabled,
            ]}
          >
            <Text style={[styles.choiceText, c.value === selected && styles.chosenText]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {message && <Text style={styles.error}>{message}</Text>}
      {stale && <Text style={styles.error}>Saved, but the page may be out of date.</Text>}
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
  seats: { fontWeight: "600" },
  plan: { marginTop: 12, fontWeight: "600" },
  choices: { flexDirection: "row", gap: 8 },
  choice: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#208AEF",
    borderRadius: 8,
    paddingVertical: 12,
  },
  chosen: { backgroundColor: "#208AEF" },
  disabled: { opacity: 0.4 },
  choiceText: { color: "#208AEF", fontSize: 16, fontWeight: "600" },
  chosenText: { color: "white" },
  error: { color: "#B00020" },
  link: { color: "#208AEF", fontSize: 16 },
});
