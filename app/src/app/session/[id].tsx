import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { PersonRow } from "@/components/person-row";
import { Pill } from "@/components/pill";
import { Hero, Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { Tile } from "@/components/tile";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/use-language";
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
import type { GroupKey } from "@/schedule/rsvp-list";
import { formatRange } from "@/schedule/time";
import { useRsvpList } from "@/schedule/use-rsvp-list";
import { useSessionDetail, type SessionDetail } from "@/schedule/use-session";
import { space, type ColorName } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studio } = useSession();
  const { colors } = useTheme();
  const t = useT();
  const detail = useSessionDetail(id);
  const ready = detail.status === "ready" && studio;

  return (
    <Screen>
      <Hero compact>
        <View style={styles.top}>
          <BackButton label={t("session.back")} />
          <Logo size={64} />
        </View>
        {detail.status === "ready" && studio ? (
          <View style={styles.titles}>
            {detail.session.status === "cancelled" && <Pill label={t("common.cancelled")} tone="ink" />}
            <Text variant="display" color="onAccent">
              {detail.session.class_type_name}
            </Text>
            <Text variant="title" color="onAccent">
              {formatRange(
                Date.parse(detail.session.starts_at),
                Date.parse(detail.session.ends_at),
                studio.timezone,
                t.locale,
              )}
            </Text>
          </View>
        ) : (
          <Text variant="display" color="onAccent">
            {t("session.title")}
          </Text>
        )}
      </Hero>

      {detail.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {detail.status === "notFound" && (
        <View style={styles.center}>
          <Text>{t("session.notAvailable")}</Text>
        </View>
      )}
      {detail.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("session.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={detail.retry} />
        </View>
      )}
      {ready && <Details session={detail.session} stale={detail.stale} rsvp={detail.rsvp} />}
    </Screen>
  );
}

// The small dot beside each group title, in the colour of the matching count tile.
const DOT: Record<GroupKey, ColorName> = {
  going: "accent",
  waitlist: "textMuted",
  maybe: "soft",
  not_going: "primary",
};

type DetailsProps = {
  session: SessionDetail;
  stale: boolean;
  rsvp: (choice: Choice) => Promise<RsvpOutcome>;
};

function Details({ session, stale, rsvp }: DetailsProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = useT();
  const counts = session.rsvp_counts;
  const list = useRsvpList(session.id);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = session.status === "cancelled";
  const seats = seatsText(t, session.seats_left, session.my_rsvp);
  const selected = selectedChoice(session.my_rsvp);

  async function send(choice: Choice) {
    setSaving(true);
    setMessage(null);
    const outcome = await rsvp(choice);
    if (outcome === "ok") void list.reload(); // the staff member's own name may have moved
    setSaving(false);
    setMessage(outcomeMessage(t, outcome));
  }

  function choose(choice: Choice) {
    if (saving || cancelled || choice === selected) return; // nothing to change
    if (session.attendance_mode !== "booking") return void send(choice);
    // A booking class: the answer can cost or free a seat, so ask first. Nothing is sent until yes.
    const ask = confirmation(t, choice, session.my_rsvp, session.seats_left);
    Alert.alert(ask.title, ask.message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: ask.confirm, onPress: () => void send(choice) },
    ]);
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.details, { paddingBottom: insets.bottom + space.xl }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.tiles}>
        <Tile label={t("session.coach")} value={session.coach_name} />
        {seats ? (
          <Tile label={t("session.seats")} value={seats} tone="primary" />
        ) : session.capacity !== null ? (
          <Tile label={t("session.capacity")} value={String(session.capacity)} />
        ) : null}
      </View>

      {session.preview && <Text>{session.preview}</Text>}

      {counts && (
        <View style={styles.group}>
          <Text variant="eyebrow">{t("session.whoIsComing")}</Text>
          <View style={styles.tiles}>
            <Tile figure label={t("rsvp.going")} value={String(counts.going)} tone="accent" />
            <Tile figure label={t("rsvp.maybe")} value={String(counts.maybe)} tone="soft" />
          </View>
          <View style={styles.tiles}>
            <Tile figure label={t("rsvp.notGoing")} value={String(counts.not_going)} tone="primary" />
            <Tile figure label={t("session.waiting")} value={String(counts.waitlist)} tone="muted" />
          </View>
          <Button
            variant="choice"
            title={t(list.state.status === "closed" ? "session.seeList" : "session.hideList")}
            onPress={list.toggle}
          />
          {list.state.status === "loading" && <ActivityIndicator color={colors.textMuted} />}
          {list.state.status === "error" && (
            <View style={styles.listMessage}>
              <Text color="danger" accessibilityRole="alert">
                {t("session.listError")}
              </Text>
              <Button variant="link" title={t("common.tryAgain")} onPress={list.retry} />
            </View>
          )}
          {list.state.status === "ready" && list.state.groups.length === 0 && (
            <Text color="textMuted">{t("session.nobody")}</Text>
          )}
          {list.state.status === "ready" &&
            list.state.groups.map((g) => (
              <View key={g.key} style={styles.people}>
                <View style={styles.groupTitle}>
                  <View style={[styles.dot, { backgroundColor: colors[DOT[g.key]] }]} />
                  <Text variant="eyebrow">
                    {t("session.groupTitle", { title: t(g.titleKey), count: g.entries.length })}
                  </Text>
                </View>
                {g.entries.map((e) => (
                  <PersonRow key={e.participant_id} name={e.name} position={e.waitlist_position} />
                ))}
              </View>
            ))}
        </View>
      )}

      <View style={styles.spacer} />

      <View style={styles.group}>
        <View style={styles.planHeader}>
          <Text variant="eyebrow">{t("session.yourPlan")}</Text>
          <Text variant="label" color="textMuted">
            {planLabel(t, session.my_rsvp)}
          </Text>
        </View>
        <View style={styles.choices}>
          {CHOICES.map((c) => (
            <View key={c.value} style={styles.choice}>
              <Button
                variant="choice"
                title={t(c.label)}
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
            {t("session.stale")}
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
  listMessage: { alignItems: "center", gap: space.xs },
  people: { gap: space.sm },
  groupTitle: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  group: { gap: space.md },
  spacer: { flexGrow: 1 },
  planHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  choices: { flexDirection: "row", gap: space.sm },
  choice: { flex: 1 },
});
