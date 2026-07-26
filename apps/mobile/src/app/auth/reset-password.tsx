import { Redirect } from "expo-router";

import { MobileResetPasswordScreen } from "@/components/mobile-reset-password-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function ResetPasswordScreen() {
  const { recoveryRequired, status } = useMobileAuth();

  if (status !== "signed-in" || !recoveryRequired) {
    return <Redirect href="/auth/sign-in" />;
  }

  return <MobileResetPasswordScreen />;
}
