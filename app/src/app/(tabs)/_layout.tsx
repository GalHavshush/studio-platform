import { Tabs } from "expo-router/js-tabs";

import { useSession } from "@/auth/session";
import { TabBar } from "@/components/tab-bar";
import { useT } from "@/i18n/use-language";
import { useTheme } from "@/theme/use-theme";

// The three main places, with the floating bar on top. Session, report and another person's
// timeline are stack screens above this group, so the bar is hidden while one of them is open.
export default function TabsLayout() {
  const { studio } = useSession();
  const { colors } = useTheme();
  const t = useT();

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.schedule") }} />
      {/* Only someone who has a participant in this studio has a timeline of their own. */}
      <Tabs.Screen name="timeline" options={{ title: t("tabs.timeline"), href: studio?.participantId ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
