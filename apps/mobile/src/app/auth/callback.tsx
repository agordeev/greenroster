import { Redirect } from "expo-router";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function AuthCallbackScreen() {
  const { pendingDestination, status } = useMobileAuth();

  if (status === "signed-out") {
    return <Redirect href="/auth/recover?status=expired" />;
  }
  if (status !== "checking") {
    return <Redirect href={pendingDestination ?? "/profile"} />;
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
        ["Destination", pendingDestination ?? "Profile"],
      ]}
    />
  );
}
