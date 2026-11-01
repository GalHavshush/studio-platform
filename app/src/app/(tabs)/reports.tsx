import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PageHeader } from "@/components/page-header";
import { ReportsToWrite } from "@/components/reports-to-write";
import { Screen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { StudioBadge } from "@/components/studio-badge";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { useT } from "@/i18n/use-language";
import { space } from "@/theme/tokens";

// The staff's reports: what is still to write, and what is written.
export default function Reports() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const [tab, setTab] = useState<"toWrite" | "written">("toWrite");
  return (
    <Screen>
      <PageHeader title={t("tabs.reports")} tag={<StudioBadge />} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}>
        <Segmented
          options={[
            { value: "toWrite", label: t("reports.toWrite") },
            { value: "written", label: t("reports.written") },
          ]}
          value={tab}
          onChange={setTab}
        />
        <View>
          <ReportsToWrite written={tab === "written"} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { padding: space.xl, gap: space.lg } });
