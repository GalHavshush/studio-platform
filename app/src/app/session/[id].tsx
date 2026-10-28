import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Pill } from "@/components/pill";
import { Hero, Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { Tile } from "@/components/tile";
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
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studio } = useSession();
  const { colors } = useTheme();
  const detail = useSessionDetail(id);
  const ready = detail.status === "ready" && studio;

  return (
    <Screen>
      <Hero compact>
        <View style={styles.top}>
          <BackButton label="Back to the schedule" />
          <Logo size={64} />
        </View>
        {detail.status === "ready" && studio ? (
          <View style={styles.titles}>
            {detail.session.status === "cancelled" && <Pill label="Cancelled" tone="ink" />}
            <Text variant="display" color="onAccent">
              {detail.session.class_type_name}
            </Text>
            <Text variant="title" color="onAccent">
              {formatRange(
                Date.parse(detail.session.starts_at),
                Date.parse(detail.session.ends_at),
                studio.timezone,
              )}
            </Text>
          </View>
        ) : (
          <Text variant="display" color="onAccent">
            Session
          </Text>
        )}
      </Hero>

      {detail.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {detail.status === "notFound" && (
        <View style={styles.center}>
          <Text>This session isn't available.</Text>
        </View>
      )}
      {detail.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            Couldn't load the session.
          </Text>
          <Button variant="link" title="Try again" onPress={detail.retry} />
        </View>
      )}
      {ready && <Details session={detail.session} stale={detail.stale} rsvp={detail.rsvp} />}
    </Screen>
  );
}

type DetailsProps = {
  session: SessionDetail;
  stale: boolean;
  rsvp: (choice: Choice) => Promise<RsvpOutcome>;
};

function Details({ session, stale, rsvp }: DetailsProps) {
  const insets = useSafeAreaInsets();
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
    <ScrollView
      contentContainerStyle={[styles.details, { paddingBottom: insets.bottom + space.xl }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.tiles}>
        <Tile label="Coach" value={session.coach_name} />
        {seats ? (
          <Tile label="Seats" value={seats} tone="primary" />
        ) : session.capacity !== null ? (
          <Tile label="Capacity" value={String(session.capacity)} />
        ) : null}
      </View>

      {session.preview && <Text>{session.preview}</Text>}

      {counts && (
        <View style={styles.group}>
          <Text variant="eyebrow">Who's coming</Text>
          <View style={styles.tiles}>
            <Tile figure label="Going" value={String(counts.going)} tone="accent" />
            <Tile figure label="Maybe" value={String(counts.maybe)} tone="soft" />
          </View>
          <View style={styles.tiles}>
            <Tile figure label="Not going" value={String(counts.not_going)} tone="primary" />
            <Tile figure label="Waiting" value={String(counts.waitlist)} tone="muted" />
          </View>
        </View>
      )}

      <View style={styles.spacer} />

      <View style={styles.group}>
        <View style={styles.planHeader}>
          <Text variant="eyebrow">Your plan</Text>
          <Text variant="label" color="textMuted">
            {planLabel(session.my_rsvp)}
          </Text>
        </View>
        <View style={styles.choices}>
          {CHOICES.map((c) => (
            <View key={c.value} style={styles.choice}>
              <Button
                variant="choice"
                title={c.label}
                selected={c.value === selected}
                disabled={saving || cancelled}
                onPress={() => choose(c.value)}
              />
            </View>
          ))}
        </View>
        {message && (
          <Text color="danger" accessibilityRole="alert">
            {message}
          </Text>
        )}
        {stale && (
          <Text color="danger" accessibilityRole="alert">
            Saved, but the page may be out of date.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titles: { gap: space.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  details: { flexGrow: 1, padding: space.xl, gap: space.xl },
  tiles: { flexDirection: "row", gap: space.md },
  group: { gap: space.md },
  spacer: { flexGrow: 1 },
  planHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  choices: { flexDirection: "row", gap: space.sm },
  choice: { flex: 1 },
});
