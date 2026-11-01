import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AddAttendeeSheet } from "@/components/add-attendee-sheet";
import { Button } from "@/components/button";
import { RollCallRow } from "@/components/roll-call-row";
import { Segmented } from "@/components/segmented";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { attendMessage } from "@/schedule/attendance";
import { markedCount, rollCall, type Person } from "@/schedule/roll-call";
import { useRollCall } from "@/schedule/use-roll-call";
import type { SessionDetail } from "@/schedule/use-session";
import { space } from "@/theme/tokens";

type Tab = "going" | "maybe" | "waiting";

type Props = {
  session: SessionDetail;
  open: boolean; // roll call is on: ticks instead of a link to each person's history
  reloadKey: unknown; // changes when the page knows the list has moved (the staff member's own answer)
};

// What staff see of a class: how many are coming, the lists by answer, and, once the class is
// open for check-in, a tick for each person who came.
export function ClassStaff({ session, open, reloadKey }: Props) {
  const t = useT();
  const router = useRouter();
  const { state, retry, mark } = useRollCall(session.id, reloadKey);
  const [tab, setTab] = useState<Tab>("going");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const counts = session.rsvp_counts;
  if (!counts) return null;

  const lists = state.status === "ready" ? rollCall(state.rsvps, state.came) : { going: [], maybe: [], waiting: [] };
  const people = lists[tab];
  const ticks = open && tab !== "waiting";
  const summary =
    (session.capacity === null
      ? t("coach.goingOnly", { going: counts.going })
      : t("coach.goingOf", { going: counts.going, capacity: session.capacity })) +
    " · " +
    t("roll.maybeWaiting", { maybe: counts.maybe, waiting: counts.waitlist });

  async function tap(p: Person) {
    setNote(null);
    setNote(attendMessage(t, await mark({ participant_id: p.id, name: p.name }, !p.came)));
  }

  return (
    <View style={styles.group}>
      <Text variant="label">{summary}</Text>
      <Segmented
        options={[
          { value: "going", label: `${t("rsvp.going")} ${counts.going}` },
          { value: "maybe", label: `${t("rsvp.maybe")} ${counts.maybe}` },
          { value: "waiting", label: `${t("session.waiting")} ${counts.waitlist}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {ticks && people.length > 0 && (
        <View style={styles.head}>
          <Text variant="eyebrow" color="textMuted">
            {t("roll.title")}
          </Text>
          <Text variant="label" color="textMuted">
            {t("roll.marked", { n: markedCount(people), total: people.length })}
          </Text>
        </View>
      )}
      {!open && session.status !== "cancelled" && (
        <Text color="textMuted">{t("roll.opens")}</Text>
      )}
      {state.status === "loading" && <ActivityIndicator />}
      {state.status === "error" && (
        <View style={styles.message}>
          <Text color="danger" accessibilityRole="alert">
            {t("session.listError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={retry} />
        </View>
      )}
      {state.status === "ready" && people.length === 0 && <Text color="textMuted">{t("session.nobody")}</Text>}
      {people.map((p) => (
        <RollCallRow
          key={p.id}
          name={p.name}
          sub={p.walkIn ? t("roll.walkIn") : p.position ? t("roll.place", { position: p.position }) : null}
          checked={ticks ? p.came : null}
          label={ticks ? p.name : t("timeline.of", { name: p.name })}
          onPress={() =>
            ticks
              ? void tap(p)
              : router.push({ pathname: "/timeline/[id]", params: { id: p.id, name: p.name } })
          }
        />
      ))}
      {note && (
        <Text color="danger" accessibilityRole="alert">
          {note}
        </Text>
      )}
      {open && state.status === "ready" && (
        <Button variant="link" title={t("roll.add")} onPress={() => setAdding(true)} />
      )}
      {adding && state.status === "ready" && (
        <AddAttendeeSheet
          attendees={state.came}
          onPick={(person) => mark(person, true)}
          onClose={() => setAdding(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.md },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  message: { alignItems: "center", gap: space.xs },
});
