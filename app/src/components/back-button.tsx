import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { Text } from "@/components/text";
import { useTheme } from "@/theme/use-theme";

// The round back button on the page header, in place of the system navigation bar.
export function BackButton({ label }: { label: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.back()}
      style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text variant="title" style={styles.chevron}>
        ‹
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chevron: { fontSize: 28, lineHeight: 32, marginTop: -3 },
});
