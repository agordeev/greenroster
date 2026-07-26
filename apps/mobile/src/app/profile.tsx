import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function ProfileScreen() {
  const { recoveryRequired, status } = useMobileAuth();
  const accountStatus =
    status === "checking"
      ? "Checking session"
      : status === "signed-in"
        ? recoveryRequired
          ? "Password recovery"
          : "Session available"
        : status === "error"
          ? "Session needs attention"
          : "Signed out";

  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Identity, golf data, and privacy"
      introduction="Your account, group label, personal golf details, history, directory, standings, and privacy actions meet here."
      emptyTitle="Profile access is signed out"
      emptyBody="Sign in before personal or group data is loaded. GreenRoster keeps protected profile data out of the general device cache."
      facts={[
        ["Account", accountStatus],
        ["Group", "Not resolved"],
        ["Legal status", "Not loaded"],
      ]}
    />
  );
}
