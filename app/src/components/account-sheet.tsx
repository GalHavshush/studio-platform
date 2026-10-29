import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { LANGUAGES } from "@/i18n/translate";
import { useLanguage } from "@/i18n/use-language";
import { PREFERENCES } from "@/theme/preference";
import { radius, space } from "@/theme/tokens";
import { usePreference } from "@/theme/use-preference";
import { useTheme } from "@/theme/use-theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  // only offered when the studio named this person's own participant
  onTimeline?: () => void;
  // only offered to people who belong to more than one studio
  onSwitchStudio?: () => void;
  onSignOut: () => void;
};

// Opens from the avatar on the schedule: where to go (another studio), how the app looks, and out.
export function AccountSheet({ visible, onClose, onTimeline, onSwitchStudio, onSignOut }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = usePreference();
  const { t, choice, setChoice } = useLanguage();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      {/* Tapping the dimmed area closes the sheet. */}
      <Pressable
        accessibilityLabel={t("account.close")}
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
        {onTimeline && (
          <Button
            variant="choice"
            title={t("timeline.mine")}
            onPress={() => {
              onClose();
              onTimeline();
            }}
          />
        )}
        {onSwitchStudio && (
          <Button
            variant="choice"
            title={t("account.switchStudio")}
            onPress={() => {
              onClose();
              onSwitchStudio();
            }}
          />
        )}
        <Text variant="eyebrow">{t("account.appearance")}</Text>
        <View style={styles.options}>
          {PREFERENCES.map((p) => (
            <View key={p.value} style={styles.option}>
              <Button
                variant="choice"
                title={t(p.label)}
                selected={p.value === preference}
                onPress={() => setPreference(p.value)}
              />
            </View>
          ))}
        </View>
        <Text variant="eyebrow">{t("account.language")}</Text>
        <View style={styles.options}>
          <View style={styles.option}>
            <Button
              variant="choice"
              title={t("common.system")}
              selected={choice === "system"}
              onPress={() => setChoice("system")}
            />
          </View>
          {LANGUAGES.map((l) => (
            <View key={l.value} style={styles.option}>
              <Button
                variant="choice"
                title={l.name}
                selected={l.value === choice}
                onPress={() => setChoice(l.value)}
              />
            </View>
          ))}
        </View>
        <Button
          variant="link"
          title={t("account.signOut")}
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
