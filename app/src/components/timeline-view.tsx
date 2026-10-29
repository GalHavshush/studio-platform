import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { TimelineCard } from "@/components/timeline-card";
import { useT } from "@/i18n/use-language";
import { useTimeline } from "@/schedule/use-timeline";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = {
  id: string;
  // only shown (staff opening someone else's timeline); the id alone decides what loads
  name?: string;
  // true when this is the member's own timeline in the tab bar: no back button, room for the bar
  tab?: boolean;
};

// A person's classes, newest first. Used as the "Timeline" tab (your own) and as a screen above the
// tabs (staff opening someone else's).
export function TimelineView({ id, name, tab = false }: Props) {
  const { studio } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const timeline = useTimeline(id);
  // ponytail: read once when the screen opens; "upcoming" and "no record" are judged against it.
  const [now] = useState(Date.now);

  return (
    <Screen>
      <PageHeader title={t("timeline.title")} subtitle={name} backLabel={tab ? undefined : t("timeline.back")} />

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
          contentContainerStyle={{
            padding: space.xl,
            paddingBottom: insets.bottom + space.xl + (tab ? TAB_BAR_SPACE : 0),
          }}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  gap: { height: space.md },
  empty: { textAlign: "center", padding: space.xl },
  footer: { alignItems: "center", gap: space.sm, paddingTop: space.lg },
});
