import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession, type Studio } from "@/auth/session";
import { StudioMark } from "@/components/studio-badge";
import { Text } from "@/components/text";
import { useT } from "@/i18n/use-language";
import { space } from "@/theme/tokens";

// The top of every Home: the studio's mark and name, and a greeting for whoever is signed in.
export function HomeHeader() {
  const { studio, user } = useSession();
  const { name } = studio as Studio;
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <StudioMark name={name} size={48} />
      <View style={styles.titles}>
        <Text variant="pageTitle" numberOfLines={1}>
          {name}
        </Text>
        {user && (
          <Text variant="label" color="textMuted">
            {t("home.hi", { name: user.name.split(" ")[0] })}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.md },
  titles: { flex: 1 },
});
