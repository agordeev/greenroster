import { Redirect } from "expo-router";

import { MobileAuthScreen } from "@/components/mobile-auth-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";

export default function SignInScreen() {
  const { status } = useMobileAuth();

  if (status === "signed-in") return <Redirect href="/profile" />;

  return <MobileAuthScreen mode="sign-in" />;
}
