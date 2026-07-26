import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MobileSignOutButton } from "@/components/mobile-sign-out-button";

export default function ProfileScreen() {
  const { recoveryRequired } = useMobileAuth();

  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Identity, golf data, and privacy"
      introduction="Your account, group label, personal golf details, history, directory, standings, and privacy actions meet here."
      emptyTitle={
        recoveryRequired
          ? "Password recovery must be completed"
          : "Profile data is not loaded"
      }
      emptyBody={
        recoveryRequired
          ? "This recovery-only session cannot load member data. Continue to password replacement when prompted."
          : "Authenticated group and profile data will appear after the server resolves your membership."
      }
      facts={[
        ["Account", recoveryRequired ? "Password recovery" : "Signed in"],
        ["Group", "Not resolved"],
        ["Legal status", "Not loaded"],
      ]}
    >
      <MobileSignOutButton />
    </MemberDestinationScreen>
  );
}
