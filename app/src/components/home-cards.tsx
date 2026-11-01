import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { Text } from "@/components/text";
import { Tile } from "@/components/tile";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type NextProps = {
  time: string;
  title: string;
  day: string;
  tag?: string; // where the member stands; the coach's list has none
  label: string; // what a screen reader says for the whole card
  onPress: () => void;
};

// One of the member's coming classes: the time big, the class and its day, and where they stand.
export function NextClassCard({ time, title, day, tag, label, onPress }: NextProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, styles.next, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text variant="time" style={styles.time}>
        {time}
      </Text>
      <View style={styles.text}>
        <Text variant="title">{title}</Text>
        <Text variant="label" color="textMuted">
          {day}
        </Text>
      </View>
      {tag && <Pill label={tag} tone="ink" />}
    </Pressable>
  );
}

type NoteProps = { when: string; tag: string; body: string; label: string; onPress: () => void };

// The latest note a coach shared with the member, opening the class it belongs to.
export function CoachNoteCard({ when, tag, body, label, onPress }: NoteProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.noteTop}>
        <Text variant="label" color="textMuted" style={styles.text}>
          {when}
        </Text>
        <Pill label={tag} tone="accent" />
      </View>
      <Text numberOfLines={4}>{body}</Text>
    </Pressable>
  );
}

type NextUpProps = {
  when: string; // "Next up", "Now" or "in 25 min"
  time: string;
  title: string;
  meta: string; // the length of the class
  counts: { value: string; label: string }[];
  whoLabel: string;
  attendanceLabel: string;
  onOpen: () => void;
};

// The coach's next class: when it is, how many are coming and the two things to do about it.
export function NextUpCard({ when, time, title, meta, counts, whoLabel, attendanceLabel, onOpen }: NextUpProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, styles.up, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pill label={when} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${time}`} onPress={onOpen} style={styles.next}>
        <Text variant="time" style={styles.time}>
          {time}
        </Text>
        <View style={styles.text}>
          <Text variant="title">{title}</Text>
          <Text variant="label" color="textMuted">
            {meta}
          </Text>
        </View>
      </Pressable>
      {counts.length > 0 && (
        <View style={styles.counts}>
          {counts.map((c) => (
            <Tile key={c.label} figure label={c.label} value={c.value} />
          ))}
        </View>
      )}
      <View style={styles.actions}>
        <Button variant="outline" title={whoLabel} onPress={onOpen} />
        <Button title={attendanceLabel} onPress={onOpen} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  up: { gap: space.md, alignItems: "flex-start" },
  counts: { flexDirection: "row", gap: space.sm, alignSelf: "stretch" },
  actions: { gap: space.sm, alignSelf: "stretch" },
  card: { borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg },
  next: { flexDirection: "row", alignItems: "center", gap: space.md },
  time: { minWidth: 64 },
  text: { flex: 1 },
  note: { gap: space.sm },
  noteTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
});
