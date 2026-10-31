import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed";
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
import { LanguageProvider, useLanguage } from "@/i18n/use-language";
import { WeekStartProvider, useWeekStart } from "@/schedule/use-week-start";
import { PreferenceProvider, usePreference } from "@/theme/use-preference";
import { useTheme } from "@/theme/use-theme";

// Keep the native splash screen up until we know whether a stored session exists, the font is
// ready and the saved appearance, language and week start have been read (so the first frame is already right).
SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { status, studio } = useSession();
  const { loaded: preferenceLoaded } = usePreference();
  const { loaded: languageLoaded } = useLanguage();
  const { loaded: weekStartLoaded } = useWeekStart();
  const { colors } = useTheme();
  // `error` is true if a font could not load: show the app in the system font rather than never.
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });
  const ready =
    status !== "loading" && preferenceLoaded && languageLoaded && weekStartLoaded && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  // A screen whose guard is false does not exist: signing in or out switches the set of screens
  // and the router moves to the one that is left. Every screen draws its own header.
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Protected guard={status === "signedIn" && studio !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="class-types/index" />
        <Stack.Screen name="class-types/[id]" />
        <Stack.Screen name="series/index" />
        <Stack.Screen name="series/new" />
        <Stack.Screen name="series/[id]" />
        <Stack.Screen name="series/edit/[id]" />
        <Stack.Screen name="session/new" />
        <Stack.Screen name="session/[id]" />
        <Stack.Screen name="session/edit/[id]" />
        <Stack.Screen name="session/report/[id]" />
        <Stack.Screen name="timeline/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn" && studio === null}>
        <Stack.Screen name="select-studio" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <PreferenceProvider>
      <LanguageProvider>
        <WeekStartProvider>
          <SessionProvider>
            <Navigator />
          </SessionProvider>
        </WeekStartProvider>
      </LanguageProvider>
    </PreferenceProvider>
  );
}
