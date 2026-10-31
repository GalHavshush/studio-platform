import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { seatsFilled } from "@/schedule/seats";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  time: string; // "07:00"
  minutes: number;
  coach: string;
  // the seat line ("3 seats left", "Full: ...") and the numbers behind the bar; null without seats
  seats: string | null;
  capacity: number | null;
  seatsLeft: number | null;
};

// The top of the class page, like a ticket: the start time big, the length, who teaches it and, for
// a booking class with a limit, how full it is.
export function ClassPass({ time, minutes, coach, seats, capacity, seatsLeft }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const filled = seatsFilled(capacity, seatsLeft);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.top}>
        <Text variant="display" style={styles.time}>
          {time}
        </Text>
        <Text variant="label" color="textMuted">
          {t("series.minutes", { count: minutes })}
        </Text>
      </View>
      <View style={styles.line}>
        <Text variant="label" color="textMuted">
          {t("session.coach")}
        </Text>
        <Text variant="rowName">{coach}</Text>
      </View>
      {seats !== null && (
        <View style={styles.seats}>
          {filled !== null && (
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View style={[styles.fill, { backgroundColor: colors.accent, width: `${Math.round(filled * 100)}%` }]} />
            </View>
          )}
          <Text variant="label">{seats}</Text>
        </View>
      )}
      {seats === null && capacity !== null && (
        <View style={styles.line}>
          <Text variant="label" color="textMuted">
            {t("session.capacity")}
          </Text>
          <Text variant="rowName">{capacity}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg, gap: space.md },
  top: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  time: { fontSize: 64, lineHeight: 60 },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  seats: { gap: space.sm },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
});
