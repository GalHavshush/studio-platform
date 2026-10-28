import {
  Figtree_400Regular,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/figtree";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { SessionProvider, useSession } from "@/auth/session";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Keep the native splash screen up until we know whether a stored session exists and the font is ready.
SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { status, studio } = useSession();
  const { colors } = useTheme();
  // `error` is true if a font could not load: show the app in the system font rather than never.
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });
  const ready = status !== "loading" && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  // A screen whose guard is false does not exist: signing in or out switches the set of screens
  // and the router moves to the one that is left.
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fontFamily.bold },
      }}
    >
      <Stack.Protected guard={status === "signedIn" && studio !== null}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="session/[id]"
          options={{ title: "Session", headerBackTitle: "Schedule" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn" && studio === null}>
        <Stack.Screen name="select-studio" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
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
