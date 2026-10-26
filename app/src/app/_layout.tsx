import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { SessionProvider, useSession } from "@/auth/session";

// Keep the native splash screen up until we know whether a stored session exists.
SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "loading") SplashScreen.hide();
  }, [status]);

  if (status === "loading") return null;

  // A screen whose guard is false does not exist: signing in or out switches the set of screens
  // and the router moves to the one that is left.
  return (
    <Stack>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="index" options={{ title: "Studio" }} />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" options={{ title: "Sign in" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  );
}
