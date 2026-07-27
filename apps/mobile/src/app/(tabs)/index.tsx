import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { GroupDirectoryLink } from "@/components/group-directory-link";

export default function HomeScreen() {
  return (
    <MemberDestinationScreen
      eyebrow="Home"
      title="Your next round starts here"
      introduction="Live play, the next RSVP, action-required items, and the latest result will appear in priority order."
      emptyTitle="Group not loaded"
      emptyBody="Sign in with your person-specific account to load the group and member-safe Home projection."
      facts={[
        ["Live round", "Not loaded"],
        ["Next RSVP", "Not loaded"],
        ["Recent result", "Not loaded"],
      ]}
    >
      <GroupDirectoryLink />
    </MemberDestinationScreen>
  );
}
