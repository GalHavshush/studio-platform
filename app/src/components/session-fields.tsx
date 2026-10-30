import { ScrollView, StyleSheet, View } from "react-native";

import { ChoiceChip } from "@/components/choice-chip";
import { Stepper } from "@/components/stepper";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/use-language";
import { MINUTE_STEP, seatsValue, wrap, type NewSessionForm } from "@/schedule/new-session";
import { formatDay } from "@/schedule/time";
import type { StaffMember } from "@/schedule/use-staff";
import { space } from "@/theme/tokens";

const two = (n: number) => String(n).padStart(2, "0");

type Props = {
  form: NewSessionForm;
  change: (patch: Partial<NewSessionForm>) => void;
  days?: number[]; // without it the day is not offered (a weekly class keeps its weekday)
  durations: number[];
  now: number;
  zone: string;
  seatsShown: boolean;
  busy: boolean;
  // the owner's coach picker: who can teach, and who is asking (marked "you"); empty hides the row
  staff?: StaffMember[];
  me?: string;
};

// The day, start, length and seats of a class: the same fields to create one and to edit one.
export function SessionFields({ form, change, days, durations, now, zone, seatsShown, busy, staff = [], me }: Props) {
  const t = useT();
  return (
    <>
      {staff.length > 0 && (
        <View style={styles.group}>
          <Text variant="eyebrow">{t("newSession.coach")}</Text>
          <View style={styles.wrap}>
            {staff.map((p) => (
              <ChoiceChip
                key={p.id}
                label={p.id === me ? t("newSession.you", { name: p.name }) : p.name}
                selected={(form.coachId ?? me) === p.id}
                onPress={() => change({ coachId: p.id })}
              />
            ))}
          </View>
        </View>
      )}

      {days && (
        <View style={styles.group}>
          <Text variant="eyebrow">{t("newSession.day")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {days.map((d) => (
              <ChoiceChip
                key={d}
                label={formatDay(d, now, zone, t)}
                selected={form.dayStart === d}
                onPress={() => change({ dayStart: d })}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.group}>
        <Text variant="eyebrow">{t("newSession.start")}</Text>
        <View style={styles.time}>
          <Stepper
            value={two(form.hour)}
            onUp={() => change({ hour: wrap(form.hour, 1, 24) })}
            onDown={() => change({ hour: wrap(form.hour, -1, 24) })}
            upLabel={t("newSession.up", { what: t("newSession.hour") })}
            downLabel={t("newSession.down", { what: t("newSession.hour") })}
          />
          <Text variant="title">:</Text>
          <Stepper
            value={two(form.minute)}
            onUp={() => change({ minute: wrap(form.minute, MINUTE_STEP, 60) })}
            onDown={() => change({ minute: wrap(form.minute, -MINUTE_STEP, 60) })}
            upLabel={t("newSession.up", { what: t("newSession.minute") })}
            downLabel={t("newSession.down", { what: t("newSession.minute") })}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text variant="eyebrow">{t("newSession.length")}</Text>
        <View style={styles.wrap}>
          {durations.map((m) => (
            <ChoiceChip
              key={m}
              label={t("newSession.minutes", { n: m })}
              selected={form.duration === m}
              onPress={() => change({ duration: m })}
            />
          ))}
        </View>
      </View>

      {seatsShown && (
        <View style={styles.group}>
          <TextField
            label={t("newSession.seats")}
            value={form.seats}
            onChangeText={(seats) => change({ seats })}
            keyboardType="number-pad"
            maxLength={4}
            editable={!busy}
          />
          <Text color={seatsValue(form.seats) === "invalid" ? "danger" : "textMuted"}>
            {seatsValue(form.seats) === "invalid" ? t("newSession.seatsInvalid") : t("newSession.seatsHint")}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chips: { flexDirection: "row", gap: space.sm },
  time: { flexDirection: "row", alignItems: "center", gap: space.md },
});
