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

  // "/" is the schedule; a member's first page is Home, so they are sent there once when the tabs open.
  useEffect(() => {
    if (studio?.role !== "member" || landed.current) return;
    landed.current = true;
    router.navigate("/home");
  }, [studio?.role, router]);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      {/* Home is the member's first page; coaches and owners get theirs in later steps. */}
      <Tabs.Screen name="home" options={{ title: t("tabs.home"), href: studio?.role === "member" ? undefined : null }} />
      <Tabs.Screen name="index" options={{ title: t("tabs.schedule") }} />
      {/* Someone with a participant has a timeline of their own; staff have reports to write. */}
      <Tabs.Screen name="timeline" options={{ title: t("tabs.timeline"), href: studio?.participantId || (studio && isStaff(studio.role)) ? undefined : null }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
