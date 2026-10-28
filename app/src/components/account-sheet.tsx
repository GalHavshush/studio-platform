import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { PREFERENCES } from "@/theme/preference";
import { radius, space } from "@/theme/tokens";
import { usePreference } from "@/theme/use-preference";
import { useTheme } from "@/theme/use-theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  // only offered to people who belong to more than one studio
  onSwitchStudio?: () => void;
  onSignOut: () => void;
};

// Opens from the avatar on the schedule: where to go (another studio), how the app looks, and out.
export function AccountSheet({ visible, onClose, onSwitchStudio, onSignOut }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = usePreference();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      {/* Tapping the dimmed area closes the sheet. */}
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + space.xl },
        ]}
      >
        {onSwitchStudio && (
          <Button
            variant="choice"
            title="Switch studio"
            onPress={() => {
              onClose();
              onSwitchStudio();
            }}
          />
        )}
        <Text variant="eyebrow">Appearance</Text>
        <View style={styles.options}>
          {PREFERENCES.map((p) => (
            <View key={p.value} style={styles.option}>
              <Button
                variant="choice"
                title={p.label}
                selected={p.value === preference}
                onPress={() => setPreference(p.value)}
              />
            </View>
          ))}
        </View>
        <Button
          variant="link"
          title="Sign out"
          onPress={() => {
            onClose();
            onSignOut();
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.md,
  },
  options: { flexDirection: "row", gap: space.sm },
  option: { flex: 1 },
});
