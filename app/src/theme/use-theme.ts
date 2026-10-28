import { useColorScheme } from "react-native";

import { colors, type Scheme } from "./tokens";

// Follows the phone's light/dark setting.
export function useTheme() {
  const scheme: Scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: colors[scheme] };
}
