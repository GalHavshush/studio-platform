import { Image, type ImageStyle, type StyleProp } from "react-native";

import { useT } from "@/i18n/use-language";

// `mark` is the figure alone, without its cream tile (cream and blue, for the orange hero blocks);
// the default is the logo on its tile.
export function Logo({ size, mark = false, style }: { size: number; mark?: boolean; style?: StyleProp<ImageStyle> }) {
  const t = useT();
  return (
    <Image
      accessibilityLabel={t("logo.label")}
      source={mark ? require("../../assets/images/logo-mark.png") : require("../../assets/images/logo.png")}
      style={[{ width: size, height: size }, style]}
    />
  );
}
