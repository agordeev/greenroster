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
      title="Signing you in"
      introduction="Hang on while we finish signing you in."
      emptyTitle="Checking your sign-in"
      emptyBody="Keep the app open. Your group appears once you're signed in."
      facts={[
        ["Sign-in", "Checking"],
        ["Group", "Appears after sign-in"],
        ["Next screen", pendingDestination ?? "Profile"],
      ]}
    />
  );
}
