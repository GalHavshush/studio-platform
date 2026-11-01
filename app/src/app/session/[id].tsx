import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { ClassPass } from "@/components/class-pass";
import { ClassStaff } from "@/components/class-staff";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
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
import {
  ATTENDANCE_CHOICES,
  attendMessage,
  attendanceState,
  attendanceText,
  type AttendOutcome,
} from "@/schedule/attendance";
import { canChange, changeMessage } from "@/schedule/edit-session";
import { canWriteReport } from "@/schedule/report";
import { formatDay, formatTime, startOfDay } from "@/schedule/time";
import { useNow } from "@/schedule/use-now";
import { useSessionDetail, type SessionDetail } from "@/schedule/use-session";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studio } = useSession();
  const { colors } = useTheme();
  const t = useT();
  const detail = useSessionDetail(id);
  const now = useNow(60_000);
  const ready = detail.status === "ready" && studio;

  return (
    <Screen>
      {detail.status === "ready" && studio ? (
        <PageHeader
          backLabel={t("session.back")}
          tag={detail.session.status === "cancelled" ? <Pill label={t("common.cancelled")} tone="ink" /> : undefined}
          title={detail.session.class_type_name}
          subtitle={formatDay(
            startOfDay(Date.parse(detail.session.starts_at), studio.timezone),
            now,
            studio.timezone,
            t,
          )}
        />
      ) : (
        <PageHeader backLabel={t("session.back")} title={t("session.title")} />
      )}

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
      {ready && <Details session={detail.session} stale={detail.stale} rsvp={detail.rsvp} attend={detail.attend} cancel={detail.cancel} remove={detail.remove} />}
    </Screen>
  );
}

type DetailsProps = {
  session: SessionDetail;
  stale: boolean;
  rsvp: (choice: Choice) => Promise<RsvpOutcome>;
  attend: (attended: boolean) => Promise<AttendOutcome>;
  cancel: ReturnType<typeof useSessionDetail>["cancel"];
  remove: ReturnType<typeof useSessionDetail>["remove"];
};

function Details({ session, stale, rsvp, attend, cancel, remove }: DetailsProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const t = useT();
  const counts = session.rsvp_counts;
  // ponytail: read once when the screen opens, so a class that starts while it is open shows the report button on the next visit.
  const [openedAt] = useState(Date.now);
  const now = useNow(30_000); // the check-in window can open while the screen is open
  const [attending, setAttending] = useState(false);
  const [attendNote, setAttendNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = session.status === "cancelled";
  const { studio, user } = useSession();
  const mayChange = studio !== null && canChange(session, studio.role, user?.id);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const attendance = attendanceState(session, now);
  const seats = seatsText(t, session.seats_left, session.my_rsvp);
  const selected = selectedChoice(session.my_rsvp);

  async function send(choice: Choice) {
    setSaving(true);
    setMessage(null);
    const outcome = await rsvp(choice);
    setSaving(false);
    setMessage(outcomeMessage(t, outcome));
  }

  async function answer(attended: boolean) {
    if (attending || attended === session.my_attended) return; // nothing to change
    setAttending(true);
    setAttendNote(null);
    const outcome = await attend(attended);
    setAttending(false);
    setAttendNote(attendMessage(t, outcome));
  }

  function askCancel() {
    Alert.alert(t("session.cancelAsk"), t("session.cancelAskBody"), [
      { text: t("session.cancelKeep"), style: "cancel" },
      {
        text: t("session.cancelClass"),
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          setChangeNote(null);
          setChangeNote(changeMessage(t, await cancel()));
          setCancelling(false);
        },
      },
    ]);
  }

  function askDelete() {
    Alert.alert(t("session.deleteAsk"), t("session.deleteAskBody"), [
      { text: t("session.cancelKeep"), style: "cancel" },
      {
        text: t("session.deleteClass"),
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          setChangeNote(null);
          const outcome = await remove();
          if (outcome === "ok") router.back();
          else {
            setChangeNote(changeMessage(t, outcome));
            setDeleting(false);
          }
        },
      },
    ]);
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

  const start = Date.parse(session.starts_at);
  const minutes = Math.round((Date.parse(session.ends_at) - start) / 60_000);

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.details} showsVerticalScrollIndicator={false}>
        <ClassPass
          time={formatTime(start, studio?.timezone ?? "UTC", t.locale)}
          minutes={minutes}
          coach={session.coach_name}
          seats={seats}
          capacity={session.capacity}
          seatsLeft={session.seats_left}
        />

        {session.preview && (
          <View style={[styles.about, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="eyebrow" color="textMuted">
              {t("session.about")}
            </Text>
            <Text>{session.preview}</Text>
          </View>
        )}

        {counts && <ClassStaff session={session} open={attendance === "open"} reloadKey={session.my_rsvp} />}

        {canWriteReport(session, openedAt) && (
          <Button
            variant="choice"
            title={t("report.title")}
            onPress={() => router.push({ pathname: "/session/report/[id]", params: { id: session.id } })}
          />
        )}

        {session.series_id !== null &&
          (studio?.role === "owner" ? (
            <Button
              variant="link"
              title={t("session.partOfSeries")}
              onPress={() => router.push({ pathname: "/series/[id]", params: { id: session.series_id as string } })}
            />
          ) : (
            <Text color="textMuted">{t("session.partOfSeries")}</Text>
          ))}

        {mayChange && (
          <View style={styles.group}>
            <Button
              variant="choice"
              title={t("session.edit")}
              onPress={() => router.push({ pathname: "/session/edit/[id]", params: { id: session.id } })}
            />
            <Button variant="outline" title={t("session.cancelClass")} busy={cancelling} onPress={askCancel} />
            {studio?.role === "owner" && session.series_id === null && (
              <Button variant="link" title={t("session.deleteClass")} busy={deleting} onPress={askDelete} danger />
            )}
            {changeNote && (
              <Text color="danger" accessibilityRole="alert">
                {changeNote}
              </Text>
            )}
          </View>
        )}

        {attendance === "open" && (
          <View style={styles.group}>
            <Text variant="eyebrow">{t("attendance.title")}</Text>
            <View style={styles.choices}>
              {ATTENDANCE_CHOICES.map((c) => (
                <View key={c.label} style={styles.choice}>
                  <Button
                    variant="choice"
                    title={t(c.label)}
                    selected={c.value === session.my_attended}
                    disabled={attending}
                    onPress={() => answer(c.value)}
                  />
                </View>
              ))}
            </View>
            {attendNote && (
              <Text color="danger" accessibilityRole="alert">
                {attendNote}
              </Text>
            )}
          </View>
        )}
        {attendance === "closed" && attendanceText(t, session.my_attended) && (
          <Text color="textMuted">{attendanceText(t, session.my_attended)}</Text>
        )}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + space.md },
        ]}
      >
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  page: { flex: 1 },
  details: { flexGrow: 1, padding: space.xl, gap: space.xl },
  about: { borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg, gap: space.sm },
  footer: { borderTopWidth: 1, paddingHorizontal: space.xl, paddingTop: space.md },
  group: { gap: space.md },
  planHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  choices: { flexDirection: "row", gap: space.sm },
  choice: { flex: 1 },
});
