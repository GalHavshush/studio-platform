import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { weekdayName } from "@/schedule/series";
import { useSeries } from "@/schedule/use-series";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Owner only (the weekly classes list is): says this is one week of a weekly class and links to the whole series.
export function SeriesCard({ seriesId, className }: { seriesId: string; className: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const t = useT();
  const series = useSeries();
  const found = series.status === "ready" ? series.series.find((s) => s.id === seriesId) : undefined;

  // while it loads, or if the weekly class can't be read, the card waits: a wrong day would be worse than none
  if (!found) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="eyebrow" color="textMuted">
        {t("editSession.thisWeek")}
      </Text>
      <Text variant="title">{`${t("series.every", { day: weekdayName(found.weekday, t.locale) })} · ${className}`}</Text>
      <Text color="textMuted">{t("editSession.thisDayOnly")}</Text>
      <Button
        variant="link"
        title={t("editSession.everyWeek")}
        onPress={() => router.push({ pathname: "/series/[id]", params: { id: seriesId } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg - 4, borderWidth: 1, padding: space.lg, gap: space.sm },
});
