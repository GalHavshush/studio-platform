import { Text as RNText, type TextProps } from "react-native";

import { type ColorName, type TypeName, type } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

type Props = TextProps & { variant?: TypeName; color?: ColorName };

export function Text({ variant = "body", color = "text", style, ...rest }: Props) {
  const { colors } = useTheme();
  return <RNText {...rest} style={[type[variant], { color: colors[color] }, style]} />;
}
