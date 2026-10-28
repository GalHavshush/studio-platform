import { Image } from "react-native";

import { useT } from "@/i18n/use-language";

export function Logo({ size }: { size: number }) {
  const t = useT();
  return (
    <Image
      accessibilityLabel={t("logo.label")}
      source={require("../../assets/images/logo.png")}
      style={{ width: size, height: size }}
    />
  );
}
