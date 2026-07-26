import { Redirect, useLocalSearchParams } from "expo-router";

import { MobileAuthScreen } from "@/components/mobile-auth-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function SignInScreen() {
  const { pendingDestination, status } = useMobileAuth();
  const { status: resultStatus } = useLocalSearchParams<{ status?: string }>();

  if (status === "signed-in") {
    return <Redirect href={pendingDestination ?? "/profile"} />;
  }

  return (
    <MobileAuthScreen
      mode="sign-in"
      initialMessage={
        resultStatus === "password-updated"
          ? "Password updated. Sign in with your new password."
          : undefined
      }
    />
  );
}
