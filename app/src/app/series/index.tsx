import { useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { seriesRows } from "@/schedule/series";
import { useSeries } from "@/schedule/use-series";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The owner's list of weekly classes: what repeats, when, and who teaches it.
export default function WeeklyClassesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const list = useSeries();

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
          <Button title={t("series.new")} onPress={() => router.push("/series/new")} />
          {list.series.length === 0 && <Text color="textMuted">{t("series.empty")}</Text>}
          {seriesRows(t, list.series, list.types, list.staff).map((row) => (
            <View key={row.id} style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text variant="title">{row.title}</Text>
              <Text>{row.when}</Text>
              <Text color="textMuted">{row.coach}</Text>
              <Text color="textMuted">{row.range}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  list: { padding: space.xl, gap: space.md },
  card: { padding: space.lg, gap: space.xs, borderRadius: radius.lg - 4 },
});
