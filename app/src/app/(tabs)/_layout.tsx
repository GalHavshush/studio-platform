import { useRouter } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect, useRef } from "react";

import { isStaff } from "@/auth/role";
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
  const router = useRouter();
  const landed = useRef(false);

  // "/" is the schedule; a member's and a coach's first page is Home, so they are sent there once when the tabs open.
  const hasHome = studio?.role === "member" || studio?.role === "coach";
  useEffect(() => {
    if (!hasHome || landed.current) return;
    landed.current = true;
    router.navigate("/home");
  }, [hasHome, router]);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      {/* Home is the member's and the coach's first page; the owner gets theirs in a later step. */}
      <Tabs.Screen name="home" options={{ title: t("tabs.home"), href: hasHome ? undefined : null }} />
      <Tabs.Screen name="index" options={{ title: t("tabs.schedule") }} />
      <Tabs.Screen name="reports" options={{ title: t("tabs.reports"), href: studio && isStaff(studio.role) ? undefined : null }} />
      {/* Anyone with a participant has a timeline of their own, staff included. */}
      <Tabs.Screen name="timeline" options={{ title: t("tabs.timeline"), href: studio?.participantId ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
