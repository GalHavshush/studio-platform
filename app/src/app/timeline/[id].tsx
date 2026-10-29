import { useLocalSearchParams } from "expo-router";

import { TimelineView } from "@/components/timeline-view";

// Staff opening someone else's timeline, above the tabs (with a back button).
export default function TimelineScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <TimelineView id={id} name={name} />;
}
