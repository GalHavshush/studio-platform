import { useSession, type Studio } from "@/auth/session";
import { MyClassesView } from "@/components/my-classes-view";

// "My classes": the person's own timeline. The tab exists only when the studio named their participant.
export default function MyClasses() {
  const { studio } = useSession();
  return <MyClassesView id={(studio as Studio).participantId as string} />;
}
