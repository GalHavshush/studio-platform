import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";

export default function Home() {
  const { user, studio, leaveStudio, signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{user?.name}</Text>
      <Text>{user?.email}</Text>
      <View style={styles.memberships}>
        <Text style={styles.studio}>{studio?.name}</Text>
        <Text>Your role: {studio?.role}</Text>
        <Text>Modules: {studio?.modules.length ? studio.modules.join(", ") : "none"}</Text>
      </View>
      {(user?.memberships.length ?? 0) > 1 && (
        <Pressable onPress={leaveStudio}>
          <Text style={styles.link}>Switch studio</Text>
        </Pressable>
      )}
      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  name: { fontSize: 22, fontWeight: "600" },
  studio: { fontSize: 18, fontWeight: "600" },
  link: { color: "#208AEF", marginBottom: 12 },
  memberships: { marginVertical: 12, alignItems: "center", gap: 4 },
  button: { backgroundColor: "#208AEF", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
