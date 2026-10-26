import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useSession, type SignInResult } from "@/auth/session";

const MESSAGES: Record<Exclude<SignInResult, "ok">, string> = {
  invalid: "Wrong email or password.",
  unreachable: "Can't reach the server.",
  error: "Something went wrong. Try again.",
};

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim() !== "" && password !== "" && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    // On success this screen is replaced, so only a failure touches its state again.
    if (result !== "ok") {
      setError(MESSAGES[result]);
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={submit}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={submit}
        disabled={!canSubmit}
      >
        <Text style={styles.buttonText}>{busy ? "Signing in..." : "Sign in"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#c4c4c4",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  error: { color: "#b00020" },
  button: { backgroundColor: "#208AEF", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
