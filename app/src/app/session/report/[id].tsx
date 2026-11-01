import { useSession } from "@/auth/session";
import { useLocalSearchParams, useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AttendeeRow } from "@/components/attendee-row";
import { AddAttendeeSheet } from "@/components/add-attendee-sheet";
import { Button } from "@/components/button";
import { NoteSheet } from "@/components/note-sheet";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { ReportField } from "@/components/report-field";
import { useT } from "@/i18n/use-language";
import {
  FIELDS,
  canSave,
  isDirty,
  noteFor,
  saveMessage,
  withNote,
  type Attendee,
  type ReportForm,
  type SaveOutcome,
} from "@/schedule/report";
import { attendMessage, type AttendOutcome } from "@/schedule/attendance";
import { formatDay, startOfDay } from "@/schedule/time";
import { useNow } from "@/schedule/use-now";
import { useReport } from "@/schedule/use-report";
import { useSessionDetail } from "@/schedule/use-session";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const t = useT();
  const report = useReport(id);
  const { studio } = useSession();
  const detail = useSessionDetail(id);
  const now = useNow(60_000);
  // "Morning Yoga · Tue 3 Nov": the header's second line and the note sheet's class line
  const classLine =
    detail.status === "ready" && studio
      ? `${detail.session.class_type_name} · ${formatDay(startOfDay(Date.parse(detail.session.starts_at), studio.timezone), now, studio.timezone, t)}`
      : "";

  return (
    <Screen>
      <PageHeader title={t("report.title")} subtitle={classLine || undefined} backLabel={t("report.back")} />

      {report.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {report.status === "notFound" && (
        <View style={styles.center}>
          <Text>{t("session.notAvailable")}</Text>
        </View>
      )}
      {report.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("report.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={report.retry} />
        </View>
      )}
      {report.status === "ready" && (
        <Form classLine={classLine} saved={report.saved} attendees={report.attendees} save={report.save} setAttended={report.setAttended} />
      )}
    </Screen>
  );
}

type FormProps = {
  classLine: string;
  saved: ReportForm;
  attendees: Attendee[];
  save: (form: ReportForm) => Promise<SaveOutcome>;
  setAttended: (person: Attendee, attended: boolean) => Promise<AttendOutcome>;
};

function Form({ classLine, saved, attendees, save, setAttended }: FormProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const t = useT();
  // Starts from what was loaded; after that the text belongs to the form, not to the server's copy.
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [attendNote, setAttendNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Attendee | null>(null); // the attendee whose note sheet is open

  // Leaving with unsaved text asks first. After a save `done` lifts the guard, and only then the
  // screen is left (the effect runs after the render that lifted it).
  usePreventRemove(isDirty(form, saved) && !done, ({ data }) => {
    Alert.alert(t("report.discard.title"), t("report.discard.message"), [
      { text: t("report.discard.keep"), style: "cancel" },
      { text: t("report.discard.confirm"), style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (done) router.back();
  }, [done, router]);

  async function send() {
    setSaving(true);
    setMessage(null);
    const outcome = await save(form);
    setSaving(false);
    if (outcome === "ok") setDone(true);
    else setMessage(saveMessage(t, outcome));
  }

  function remove(person: Attendee) {
    Alert.alert(t("report.removeTitle", { name: person.name }), t("report.removeMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("report.removeConfirm"),
        style: "destructive",
        onPress: async () => setAttendNote(attendMessage(t, await setAttended(person, false))),
      },
    ]);
  }

  const blank = !canSave(form);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.field}>
            {key === "summary" && (
              <Text variant="caption" color="textMuted">
                {t("report.summaryHint")}
              </Text>
            )}
            <ReportField
              label={t(label)}
              value={form[key]}
              onChangeText={(text) => setForm((f) => ({ ...f, [key]: text }))}
              editable={!saving}
              always={key === "summary"}
            />
          </View>
        ))}
        <View style={styles.notes}>
          <Text variant="eyebrow">{t("report.notes")}</Text>
          <Text color="textMuted">{t("report.notesHint")}</Text>
          <Button variant="choice" title={t("report.addSomeone")} onPress={() => { setAttendNote(null); setAdding(true); }} />
          {attendNote && (
            <Text color="danger" accessibilityRole="alert">
              {attendNote}
            </Text>
          )}
          {attendees.length === 0 && <Text color="textMuted">{t("report.noAttendees")}</Text>}
          {attendees.map((a) => (
            <AttendeeRow key={a.participant_id} name={a.name} note={noteFor(form, a.participant_id)} onPress={() => setOpen(a)} />
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        {blank && <Text color="textMuted">{t("report.needText")}</Text>}
        {message && (
          <Text color="danger" accessibilityRole="alert">
            {message}
          </Text>
        )}
        <Button title={t("report.save")} onPress={send} busy={saving} disabled={blank || !isDirty(form, saved)} />
      </View>
      {open && (
        <NoteSheet
          person={open}
          classLine={classLine}
          note={noteFor(form, open.participant_id)}
          disabled={saving}
          onSave={(note) => setForm((f) => withNote(f, open.participant_id, note))}
          onRemove={() => remove(open)}
          onClose={() => setOpen(null)}
        />
      )}
      {adding && (
        <AddAttendeeSheet
          attendees={attendees}
          onPick={(person) => setAttended(person, true)}
          onClose={() => setAdding(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  form: { flexGrow: 1, padding: space.xl, gap: space.lg },
  field: { gap: space.xs },
  notes: { gap: space.md },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
});
