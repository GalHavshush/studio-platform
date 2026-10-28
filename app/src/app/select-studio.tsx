import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Pill } from "@/components/pill";
import { Hero, Screen, Sheet } from "@/components/screen";
import { Text } from "@/components/text";
import { useSession, type SelectResult } from "@/auth/session";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const MESSAGES: Record<Exclude<SelectResult, "ok">, string> = {
  unreachable: "Can't reach the server.",
  error: "Something went wrong. Try again.",
};

export default function SelectStudio() {
  const { user, selectStudio, signOut } = useSession();
  const { colors } = useTheme();
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
      setError(MESSAGES[result]);
      setBusyId(null);
    }
  }

  return (
    <Screen accent>
      <Hero>
        <Logo size={96} />
        <Text variant="display" color="onAccent">
          {memberships.length === 0 ? "No studio\nyet" : "Choose your\nstudio"}
        </Text>
      </Hero>
      <Sheet>
        {memberships.length === 0 && <Text>You are not a member of any studio yet.</Text>}
        {memberships.map((m) => (
          <Pressable
            key={m.tenant.id}
            accessibilityRole="button"
            accessibilityLabel={`${m.tenant.name}, ${m.role}`}
            disabled={busyId !== null}
            onPress={() => choose(m.tenant.id)}
            style={[
              styles.card,
              { backgroundColor: colors.surface },
              busyId !== null && styles.disabled,
            ]}
          >
            <View style={styles.cardText}>
              <Text variant="title">{m.tenant.name}</Text>
              <Pill label={m.role.charAt(0).toUpperCase() + m.role.slice(1)} />
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
        <Button title="Sign out" variant="link" onPress={signOut} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    padding: space.lg,
    paddingHorizontal: space.xl - 4,
    borderRadius: radius.lg,
  },
  cardText: { flex: 1, gap: space.sm },
  disabled: { opacity: 0.5 },
});
