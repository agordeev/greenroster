import { MemberDestinationScreen } from "@/components/member-destination-screen";

export default function LeaderboardScreen() {
  return (
    <MemberDestinationScreen
      eyebrow="Leaderboard"
      title="Live standings when play begins"
      introduction="The active live board will show its last server update and the ranking criterion without moving your focus."
      emptyTitle="Leaderboard not loaded"
      emptyBody="Sign in to resolve authorized live standings and recent official results."
      facts={[
        ["Round state", "Not loaded"],
        ["Last update", "Not available"],
        ["Recent results", "Not loaded"],
      ]}
    />
  );
}
