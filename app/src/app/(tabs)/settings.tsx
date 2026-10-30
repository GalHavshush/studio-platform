import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button } from "@/components/button";
import { DeleteAccountSheet } from "@/components/delete-account-sheet";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Text } from "@/components/text";
import { LANGUAGES } from "@/i18n/translate";
import { useLanguage } from "@/i18n/use-language";
import { useWeekStart } from "@/schedule/use-week-start";
import { PREFERENCES } from "@/theme/preference";
import { space } from "@/theme/tokens";
import { usePreference } from "@/theme/use-preference";
import { useTheme } from "@/theme/use-theme";

// Everything about the account and the phone: which studio, how the app looks, the language, and
// the way out. Replaces the sheet that used to open from the avatar on the schedule.
export default function Settings() {
  const { user, studio, leaveStudio, signOut, deleteAccount } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = usePreference();
  const { t, choice, setChoice } = useLanguage();
  const { colors } = useTheme();
  const { mondayStart, setMondayStart } = useWeekStart();
  const [deleting, setDeleting] = useState(false);
  // only offered to people who belong to more than one studio
  const canSwitch = (user?.memberships.length ?? 0) > 1;

  return (
    <Screen>
      <PageHeader title={t("settings.title")} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl + TAB_BAR_SPACE }]}
        showsVerticalScrollIndicator={false}
      >
        {canSwitch && <Button variant="choice" title={t("account.switchStudio")} onPress={leaveStudio} />}
        <View style={styles.group}>
          <Text variant="eyebrow">{t("account.appearance")}</Text>
          <View style={styles.options}>
            {PREFERENCES.map((p) => (
              <View key={p.value} style={styles.option}>
                <Button
                  variant="choice"
                  title={t(p.label)}
                  selected={p.value === preference}
                  onPress={() => setPreference(p.value)}
                />
              </View>
            ))}
          </View>
        </View>
        <View style={styles.group}>
          <Text variant="eyebrow">{t("account.language")}</Text>
          <View style={styles.options}>
            <View style={styles.option}>
              <Button
                variant="choice"
                title={t("common.system")}
                selected={choice === "system"}
                onPress={() => setChoice("system")}
              />
            </View>
            {LANGUAGES.map((l) => (
              <View key={l.value} style={styles.option}>
                <Button variant="choice" title={l.name} selected={l.value === choice} onPress={() => setChoice(l.value)} />
              </View>
            ))}
          </View>
        </View>
        <View style={styles.group}>
          <Text variant="eyebrow">{t("settings.schedule")}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t("settings.mondayStart")}</Text>
            <Switch
              accessibilityLabel={t("settings.mondayStart")}
              value={mondayStart}
              onValueChange={setMondayStart}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>
        {studio?.role === "owner" && (
          <View style={styles.group}>
            <Text variant="eyebrow">{t("settings.studio")}</Text>
            <Button variant="choice" title={t("settings.classTypes")} onPress={() => router.push("/class-types")} />
          </View>
        )}
        <View>
          <Button variant="link" title={t("account.signOut")} onPress={signOut} />
          <Button variant="link" danger title={t("delete.link")} onPress={() => setDeleting(true)} />
        </View>
      </ScrollView>

      {deleting && <DeleteAccountSheet onDelete={deleteAccount} onClose={() => setDeleting(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.xl },
  group: { gap: space.md },
  options: { flexDirection: "row", gap: space.sm },
  option: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  switchLabel: { flex: 1 },
});
