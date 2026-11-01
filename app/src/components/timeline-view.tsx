import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { TimelineCard } from "@/components/timeline-card";
import { useT } from "@/i18n/use-language";
import { useTimeline } from "@/schedule/use-timeline";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Someone else's classes, newest first, as full cards; staff open it above the tabs (a member's own
// classes are the "My classes" tab). The id alone decides what loads.
export function TimelineView({ id, name }: { id: string; name?: string }) {
  const { studio } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const timeline = useTimeline(id);
  // ponytail: read once when the screen opens; "upcoming" and "no record" are judged against it.
  const [now] = useState(Date.now);
  const zone = studio?.timezone ?? "UTC";

  return (
    <Screen>
      <PageHeader title={t("timeline.title")} subtitle={name} backLabel={t("timeline.back")} />
      <FlatList
        data={timeline.status === "ready" ? timeline.items : []}
        keyExtractor={(e) => e.session_id}
        contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) => <TimelineCard entry={item} timeZone={zone} now={now} />}
        ListEmptyComponent={
          timeline.status === "loading" ? (
            <ActivityIndicator style={styles.empty} color={colors.textMuted} />
          ) : timeline.status === "notFound" ? (
            <Text style={styles.empty}>{t("timeline.notAvailable")}</Text>
          ) : timeline.status === "error" ? (
            <View style={styles.center}>
              <Text color="danger" accessibilityRole="alert">
                {t("timeline.loadError")}
              </Text>
              <Button variant="link" title={t("common.tryAgain")} onPress={timeline.retry} />
            </View>
          ) : (
            <Text color="textMuted" style={styles.empty}>
              {t("timeline.empty")}
            </Text>
          )
        }
        ListFooterComponent={
          timeline.status === "ready" && timeline.next ? (
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, padding: space.xl },
  gap: { height: space.md },
  empty: { textAlign: "center", padding: space.xl },
  footer: { alignItems: "center", gap: space.sm, paddingTop: space.lg },
});
