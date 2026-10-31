import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { Hero, Screen, Sheet } from "@/components/screen";
import { StudioMark } from "@/components/studio-badge";
import { Text } from "@/components/text";
import { roleLabel } from "@/auth/role";
import { useSession, type SelectResult } from "@/auth/session";
import type { Key } from "@/i18n/en";
import { useT } from "@/i18n/use-language";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const MESSAGES: Record<Exclude<SelectResult, "ok">, Key> = {
  unreachable: "common.cantReach",
  error: "common.wentWrong",
};

export default function SelectStudio() {
  const { user, selectStudio, signOut } = useSession();
  const { colors } = useTheme();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const memberships = user?.memberships ?? [];

  async function choose(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const result = await selectStudio(id);
    // On success this screen is replaced, so only a failure touches its state again.
    if (result !== "ok") {
      setError(t(MESSAGES[result]));
      setBusyId(null);
    }
  }

  return (
    <Screen accent>
      <Hero logoSize={360}>
        <Text variant="display" color="onAccent">
          {t(memberships.length === 0 ? "studios.titleNone" : "studios.title")}
        </Text>
      </Hero>
      <Sheet>
        {memberships.length === 0 && <Text>{t("studios.none")}</Text>}
        {memberships.map((m) => (
          <Pressable
            key={m.tenant.id}
            accessibilityRole="button"
            accessibilityLabel={t("studios.cardLabel", { name: m.tenant.name, role: roleLabel(t, m.role) })}
            disabled={busyId !== null}
            onPress={() => choose(m.tenant.id)}
            style={[
              styles.card,
              { backgroundColor: colors.surface },
              busyId !== null && styles.disabled,
            ]}
          >
            <StudioMark name={m.tenant.name} size={48} />
            <View style={styles.cardText}>
              <Text variant="title">{m.tenant.name}</Text>
              <Pill label={roleLabel(t, m.role)} />
            </View>
            <Text variant="title" color="textMuted">
              ›
            </Text>
          </Pressable>
        ))}
        {error && (
          <Text color="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Button title={t("account.signOut")} variant="link" onPress={signOut} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.lg - 4,
  },
  cardText: { flex: 1, gap: space.sm },
  disabled: { opacity: 0.5 },
});
