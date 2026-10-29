import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Hero, Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { TimelineCard } from "@/components/timeline-card";
import { useT } from "@/i18n/use-language";
import { useTimeline } from "@/schedule/use-timeline";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function TimelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { studio } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const timeline = useTimeline(id);
  // ponytail: read once when the screen opens; "upcoming" and "no record" are judged against it.
  const [now] = useState(Date.now);

  return (
    <Screen>
      <Hero compact>
        <View style={styles.top}>
          <BackButton label={t("timeline.back")} />
          <Logo size={64} />
        </View>
        <Text variant="display" color="onAccent">
          {t("timeline.title")}
        </Text>
      </Hero>

      {timeline.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {timeline.status === "notFound" && (
        <View style={styles.center}>
          <Text>{t("timeline.notAvailable")}</Text>
        </View>
      )}
      {timeline.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("timeline.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={timeline.retry} />
        </View>
      )}
      {timeline.status === "ready" && studio && (
        <FlatList
          data={timeline.items}
          keyExtractor={(e) => e.session_id}
          contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => <TimelineCard entry={item} timeZone={studio.timezone} now={now} />}
          ListEmptyComponent={
            <Text color="textMuted" style={styles.empty}>
              {t("timeline.empty")}
            </Text>
          }
          ListFooterComponent={
            timeline.next ? (
              <View style={styles.footer}>
                {timeline.more === "failed" && (
                  <Text color="danger" accessibilityRole="alert">
                    {t("timeline.moreError")}
                  </Text>
                )}
                <Button
                  variant="outline"
                  title={t("schedule.showEarlier")}
                  busy={timeline.more === "busy"}
                  onPress={timeline.showMore}
                />
              </View>
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  gap: { height: space.md },
  empty: { textAlign: "center", padding: space.xl },
  footer: { alignItems: "center", gap: space.sm, paddingTop: space.lg },
});
