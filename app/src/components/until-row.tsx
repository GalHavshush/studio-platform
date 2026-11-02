import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { dateFromIso, isoFromDate } from "@/schedule/new-session";
import { dateLabel } from "@/schedule/series";
import { space } from "@/theme/tokens";

type Props = {
  until: string | null; // the last date, "2026-12-22", or null for no end
  firstDate: string; // the picker starts there and offers nothing earlier
  onChange: (until: string | null) => void;
  disabled?: boolean;
};

// "Until: No end date" of a new weekly class: tap to pick the last date, or clear it again.
export function UntilRow({ until, firstDate, onChange, disabled }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("newSeries.until")}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={styles.row}
      >
        <Text>{t("newSeries.until")}</Text>
        <Text color="textMuted">{until ? dateLabel(until, t.locale) : t("newSeries.noEnd")}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={dateFromIso(until ?? firstDate)}
          minimumDate={dateFromIso(firstDate)}
          mode="date"
          display="inline"
          onChange={(_, date) => {
            setOpen(false); // Android's dialog closes itself; on iOS one tap on a day is the answer
            if (date) onChange(isoFromDate(date));
          }}
        />
      )}
      {until && <Button variant="link" title={t("newSeries.clearEnd")} onPress={() => onChange(null)} disabled={disabled} />}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
});
