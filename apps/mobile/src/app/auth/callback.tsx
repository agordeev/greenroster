import { Redirect } from "expo-router";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function AuthCallbackScreen() {
  const { status } = useMobileAuth();

  if (status !== "checking") {
    return <Redirect href="/profile" />;
  }

  return (
    <MemberDestinationScreen
      eyebrow="Account"
      title="Finishing secure access"
      introduction="GreenRoster is exchanging the one-time callback code and restoring your person-specific session."
      emptyTitle="Checking session"
      emptyBody="Keep the app open. Protected group data stays unloaded until access is resolved."
      facts={[
        ["Callback", "Processing"],
        ["Group", "Not loaded"],
        ["Destination", "Profile"],
      ]}
    />
  );
}
