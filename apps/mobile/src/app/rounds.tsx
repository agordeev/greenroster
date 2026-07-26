import { MemberDestinationScreen } from "@/components/member-destination-screen";

export default function RoundsScreen() {
  return (
    <MemberDestinationScreen
      eyebrow="Rounds"
      title="Upcoming, live, and completed"
      introduction="Round lists keep full state words, RSVP context, and sync status together without loading an entire history."
      emptyTitle="Rounds not loaded"
      emptyBody="Upcoming and live rounds will appear after authenticated group access is resolved. Completed history stays empty until a result exists."
      facts={[
        ["Upcoming", "Not loaded"],
        ["Live", "Not loaded"],
        ["Completed", "Not loaded"],
      ]}
    />
  );
}
