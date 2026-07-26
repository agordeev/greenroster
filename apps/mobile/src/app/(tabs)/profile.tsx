import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MobileSignOutButton } from "@/components/mobile-sign-out-button";
import { useMobileFirstRun } from "@/components/mobile-first-run-provider";

export default function ProfileScreen() {
  const { recoveryRequired } = useMobileAuth();
  const firstRun = useMobileFirstRun();
  const profile = firstRun.status === "complete" ? firstRun.profile : null;

  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Identity, golf data, and privacy"
      introduction="Your account, group label, personal golf details, history, directory, standings, and privacy actions meet here."
      emptyTitle={
        recoveryRequired
          ? "Password recovery must be completed"
          : "Golf and account details are not loaded"
      }
      emptyBody={
        recoveryRequired
          ? "This recovery-only session cannot load member data. Continue to password replacement when prompted."
          : "Your required identity profile is confirmed. Optional golfer, history, notification, and privacy details arrive in later phases."
      }
      facts={[
        ["Account", recoveryRequired ? "Password recovery" : "Signed in"],
        [
          "Name",
          profile ? `${profile.firstName} ${profile.lastName}` : "Not resolved",
        ],
        [
          "Legal status",
          profile
            ? `Terms ${profile.currentTermsVersion} · Privacy ${profile.currentPrivacyVersion}`
            : "Not resolved",
        ],
      ]}
    >
      <MobileSignOutButton />
    </MemberDestinationScreen>
  );
}
