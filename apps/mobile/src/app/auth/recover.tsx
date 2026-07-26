import { Redirect, useLocalSearchParams } from "expo-router";

import { MobileAuthScreen } from "@/components/mobile-auth-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function RecoverPasswordScreen() {
  const { status: recoveryStatus } = useLocalSearchParams<{
    status?: string;
  }>();
  const { pendingDestination, status } = useMobileAuth();

  if (status === "signed-in") {
    return <Redirect href={pendingDestination ?? "/profile"} />;
  }

  return (
    <MobileAuthScreen
      initialMessage={
        recoveryStatus === "expired"
          ? "That recovery link could not be finalized. Request a new link below."
          : undefined
      }
      mode="recovery"
    />
  );
}
