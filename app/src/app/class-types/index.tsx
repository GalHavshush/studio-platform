import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { splitTypes, typeMessage, type ClassType } from "@/schedule/class-types";
import { useClassTypes } from "@/schedule/use-class-types";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

export default function ClassTypesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const types = useClassTypes();
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(type: ClassType, call: () => ReturnType<typeof types.archive>) {
    setBusyId(type.id);
    setMessage(null);
    setMessage(typeMessage(t, await call()));
    setBusyId(null);
  }

  function askArchive(type: ClassType) {
    Alert.alert(t("classTypes.archiveAsk", { name: type.name }), t("classTypes.archiveAskBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("classTypes.archive"), style: "destructive", onPress: () => void run(type, () => types.archive(type.id)) },
    ]);
  }

  function card(type: ClassType) {
    const archived = type.archived_at !== null;
    return (
      <View key={type.id} style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.name}>
          <Text variant="title" color={archived ? "textMuted" : "text"} style={styles.title}>
            {type.name}
          </Text>
          {type.attendance_mode === "booking" && <Pill label={t("classTypes.booking")} />}
        </View>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              variant="choice"
              title={t("classTypes.edit")}
              onPress={() => router.push({ pathname: "/class-types/[id]", params: { id: type.id } })}
            />
          </View>
          <View style={styles.action}>
            <Button
              variant="choice"
              title={t(archived ? "classTypes.unarchive" : "classTypes.archive")}
              busy={busyId === type.id}
              onPress={() => (archived ? void run(type, () => types.unarchive(type.id)) : askArchive(type))}
            />
          </View>
        </View>
      </View>
    );
  }

  const { active, archived } = types.status === "ready" ? splitTypes(types.types) : { active: [], archived: [] };

  return (
    <Screen>
      <PageHeader title={t("classTypes.title")} backLabel={t("classTypes.back")} />
      {types.status === "loading" && <ActivityIndicator style={styles.center} color={colors.textMuted} />}
      {types.status === "error" && (
        <View style={styles.center}>
          <Text color="danger" accessibilityRole="alert">
            {t("classTypes.loadError")}
          </Text>
          <Button variant="link" title={t("common.tryAgain")} onPress={types.retry} />
        </View>
      )}
      {types.status === "ready" && (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xl }]}>
          <Button title={t("classTypes.new")} onPress={() => router.push({ pathname: "/class-types/[id]", params: { id: "new" } })} />
          {message && (
            <Text color="danger" accessibilityRole="alert">
              {message}
            </Text>
          )}
          {active.length === 0 && archived.length === 0 && <Text color="textMuted">{t("classTypes.empty")}</Text>}
          {active.map(card)}
          {archived.length > 0 && (
            <Button
              variant="link"
              title={showArchived ? t("classTypes.hideArchived") : t("classTypes.showArchived", { count: archived.length })}
              onPress={() => setShowArchived(!showArchived)}
            />
          )}
          {showArchived && archived.map(card)}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  list: { padding: space.xl, gap: space.md },
  card: { padding: space.lg, gap: space.md, borderRadius: radius.lg - 4 },
  name: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { flexShrink: 1 },
  actions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1 },
});
