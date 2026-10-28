import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform } from "react-native";

import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Hero, Screen, Sheet } from "@/components/screen";
import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { useSession, type SignInResult } from "@/auth/session";
import type { Key } from "@/i18n/en";
import { useT } from "@/i18n/use-language";

const MESSAGES: Record<Exclude<SignInResult, "ok">, Key> = {
  invalid: "login.invalid",
  unreachable: "common.cantReach",
  error: "common.wentWrong",
};

// The orange block shrinks when the keyboard opens, so the logo is dropped to keep the title in view.
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

export default function Login() {
  const { signIn } = useSession();
  const t = useT();
  const keyboardOpen = useKeyboardOpen();
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
      setError(t(MESSAGES[result]));
      setBusy(false);
    }
  }

  return (
    <Screen accent>
      {/* Lifts the sheet above the keyboard; the orange block shrinks to make room. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Hero>
          {!keyboardOpen && <Logo size={128} />}
          <Text variant="display" color="onAccent">
            {t("login.title")}
          </Text>
        </Hero>
        <Sheet>
          <TextField
            label={t("login.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextField
            label={t("login.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            onSubmitEditing={submit}
          />
          {error && (
            <Text color="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button
            title={t(busy ? "login.signingIn" : "login.signIn")}
            onPress={submit}
            disabled={!canSubmit}
          />
        </Sheet>
      </KeyboardAvoidingView>
    </Screen>
  );
}
