import { Image } from "react-native";

export function Logo({ size }: { size: number }) {
  return (
    <Image
      accessibilityLabel="Studio logo"
      source={require("../../assets/images/logo.png")}
      style={{ width: size, height: size }}
    />
  );
}
