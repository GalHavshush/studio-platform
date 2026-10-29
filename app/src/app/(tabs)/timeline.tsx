import { useSession } from "@/auth/session";
import { TimelineView } from "@/components/timeline-view";

// The member's own timeline. The tab only exists when the studio named their participant, so the
// id is there whenever this renders.
export default function MyTimeline() {
  const { studio } = useSession();
  return <TimelineView id={studio?.participantId as string} tab />;
}
