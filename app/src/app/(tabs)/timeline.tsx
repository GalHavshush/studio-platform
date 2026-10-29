import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isStaff } from "@/auth/role";
import { useSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { ReportsToWrite } from "@/components/reports-to-write";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { TimelineView } from "@/components/timeline-view";
import { useT } from "@/i18n/use-language";
import { space } from "@/theme/tokens";

// "My classes": the staff's reports to write on top, then the person's own timeline when the studio
// named their participant. The tab exists only for one of the two.
export default function MyClasses() {
  const { studio } = useSession();
  const insets = useSafeAreaInsets();
  const t = useT();
  const reports = studio && isStaff(studio.role) ? <ReportsToWrite /> : undefined;

  if (studio?.participantId) return <TimelineView id={studio.participantId} tab header={reports} />;
  return (
    <Screen>
      <PageHeader title={t("tabs.timeline")} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}>
        {reports}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { padding: space.xl } });
