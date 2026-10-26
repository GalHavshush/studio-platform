import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession, type SelectResult } from "@/auth/session";

const MESSAGES: Record<Exclude<SelectResult, "ok">, string> = {
  unreachable: "Can't reach the server.",
  error: "Something went wrong. Try again.",
};

export default function SelectStudio() {
  const { user, selectStudio, signOut } = useSession();
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
    <View style={styles.container}>
      {memberships.length === 0 ? (
        <Text style={styles.title}>You are not a member of any studio yet.</Text>
      ) : (
        <>
          <Text style={styles.title}>Choose your studio</Text>
          {memberships.map((m) => (
            <Pressable
              key={m.tenant.id}
              style={[styles.studio, busyId !== null && styles.disabled]}
              onPress={() => choose(m.tenant.id)}
            >
              <Text style={styles.studioName}>{m.tenant.name}</Text>
              <Text>{m.role}</Text>
            </Pressable>
          ))}
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={signOut}>
        <Text style={styles.link}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: "600", textAlign: "center", marginBottom: 12 },
  studio: { borderWidth: 1, borderColor: "#208AEF", borderRadius: 8, padding: 16, gap: 4 },
  studioName: { fontSize: 18, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: { color: "#B00020", textAlign: "center" },
  link: { color: "#208AEF", textAlign: "center", marginTop: 12 },
});
