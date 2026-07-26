import { MemberDestinationScreen } from "@/components/member-destination-screen";

export default function ProfileScreen() {
  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Identity, golf data, and privacy"
      introduction="Your account, group label, personal golf details, history, directory, standings, and privacy actions meet here."
      emptyTitle="Profile access is signed out"
      emptyBody="Sign in before personal or group data is loaded. GreenRoster keeps protected profile data out of the general device cache."
      facts={[
        ["Account", "Signed out"],
        ["Group", "Not resolved"],
        ["Legal status", "Not loaded"],
      ]}
    />
  );
}
