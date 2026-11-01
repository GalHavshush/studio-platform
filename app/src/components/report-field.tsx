import { useState } from "react";
import { Pressable } from "react-native";

import { Text } from "@/components/text";
import { TextField } from "@/components/text-field";
import { MAX_LENGTH } from "@/schedule/report";
import { radius, space } from "@/theme/tokens";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  editable: boolean;
  // true shows the field at once (the summary); false folds it into a "+ label" line until it is tapped or has text
  always?: boolean;
};

// One text field of the report. The optional ones start as a "+ What went well" line and open on a
// tap; once open they stay open, even if the text is cleared.
export function ReportField({ label, value, onChangeText, editable, always }: Props) {
  const [opened, setOpened] = useState(false);
  if (!always && !opened && value === "") {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpened(true)} style={{ paddingVertical: space.sm }}>
        <Text variant="label" color="textMuted">{`+ ${label}`}</Text>
      </Pressable>
    );
  }
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChangeText}
      multiline
      maxLength={MAX_LENGTH}
      editable={editable}
      style={{ minHeight: 120, paddingTop: space.md, paddingBottom: space.md, textAlignVertical: "top", borderRadius: radius.md }}
    />
  );
}
