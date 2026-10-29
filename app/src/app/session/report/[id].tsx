import { useLocalSearchParams, useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddAttendeeSheet } from "@/components/add-attendee-sheet";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import {
  FIELDS,
  MAX_LENGTH,
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
import { useReport } from "@/schedule/use-report";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const t = useT();
  const report = useReport(id);

  return (
    <Screen>
      <PageHeader title={t("report.title")} backLabel={t("report.back")} />

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
        <Form saved={report.saved} attendees={report.attendees} save={report.save} setAttended={report.setAttended} />
      )}
    </Screen>
  );
}

type FormProps = {
  saved: ReportForm;
  attendees: Attendee[];
  save: (form: ReportForm) => Promise<SaveOutcome>;
  setAttended: (person: Attendee, attended: boolean) => Promise<AttendOutcome>;
};

function Form({ saved, attendees, save, setAttended }: FormProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const t = useT();
  // Starts from what was loaded; after that the text belongs to the form, not to the server's copy.
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [attendNote, setAttendNote] = useState<string | null>(null);

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
          <TextField
            key={key}
            label={t(label)}
            value={form[key]}
            onChangeText={(text) => setForm((f) => ({ ...f, [key]: text }))}
            multiline
            maxLength={MAX_LENGTH}
            editable={!saving}
            style={styles.input}
          />
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
          {attendees.map((a) => {
            const note = noteFor(form, a.participant_id);
            const share = t("report.share", { name: a.name });
            return (
              <View key={a.participant_id} style={styles.person}>
                <TextField
                  label={a.name}
                  value={note.body}
                  onChangeText={(body) => setForm((f) => withNote(f, a.participant_id, { body }))}
                  multiline
                  maxLength={MAX_LENGTH}
                  editable={!saving}
                  style={styles.input}
                />
                <View style={styles.shareRow}>
                  <Text style={styles.shareLabel}>{share}</Text>
                  <Switch
                    accessibilityLabel={share}
                    value={note.shared}
                    onValueChange={(shared) => setForm((f) => withNote(f, a.participant_id, { shared }))}
                    disabled={saving}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>
                <View style={styles.links}>
                  <Button
                    variant="link"
                    title={t("report.timeline")}
                    onPress={() =>
                      router.push({ pathname: "/timeline/[id]", params: { id: a.participant_id, name: a.name } })
                    }
                  />
                  <Button variant="link" title={t("report.remove", { name: a.name })} onPress={() => remove(a)} />
                </View>
              </View>
            );
          })}
        </View>
        {blank && <Text color="textMuted">{t("report.needText")}</Text>}
        {message && (
          <Text color="danger" accessibilityRole="alert">
            {message}
          </Text>
        )}
        <Button
          title={t("report.save")}
          onPress={send}
          busy={saving}
          disabled={blank || !isDirty(form, saved)}
        />
      </ScrollView>
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
  notes: { gap: space.md },
  person: { gap: space.sm },
  shareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  shareLabel: { flex: 1 },
  links: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
  // A multiline field starts at the top, taller than the one-line fields.
  input: { minHeight: 120, paddingTop: space.md, paddingBottom: space.md, textAlignVertical: "top", borderRadius: radius.md },
});
