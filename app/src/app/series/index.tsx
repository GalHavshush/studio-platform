import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { seriesGroups, todayIn } from "@/schedule/series";
import { useNow } from "@/schedule/use-now";
import { useSeries } from "@/schedule/use-series";
import { useWeekStart } from "@/schedule/use-week-start";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The owner's list of weekly classes: what repeats, when, and who teaches it.
export default function WeeklyClassesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const list = useSeries();
  const { studio } = useSession();
  const { firstDay } = useWeekStart();
  const now = useNow(60_000);

  return (
    <Screen>
      <PageHeader title={t("series.title")} backLabel={t("series.back")} />
      {list.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {list.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("series.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={list.retry} />
        </View>
      )}
      {list.status === "ready" && (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xl }]}>
          <Button title={t("series.new")} onPress={() => router.push({ pathname: "/session/new", params: { repeat: "1" } })} />
          {list.series.length === 0 && <Text color="textMuted">{t("series.empty")}</Text>}
          {seriesGroups(t, list.series, list.types, list.staff, todayIn(now, studio?.timezone ?? "UTC"), firstDay).map((group) => (
            <View key={group.weekday} style={styles.group}>
              <Text variant="eyebrow" color="textMuted">
                {group.weekday}
              </Text>
              {group.rows.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${group.weekday} ${row.time}`}
                  onPress={() => router.push({ pathname: "/series/[id]", params: { id: row.id } })}
                  style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text variant="time" style={styles.time}>
                    {row.time}
                  </Text>
                  <View style={styles.what}>
                    <Text variant="title">{row.title}</Text>
                    <Text color="textMuted">{row.note}</Text>
                  </View>
                  <Text variant="title" color="textMuted">
                    ›
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  list: { padding: space.xl, gap: space.xl },
  group: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg - 4, borderWidth: 1 },
  time: { minWidth: 64 },
  what: { flex: 1, gap: space.xs },
});
