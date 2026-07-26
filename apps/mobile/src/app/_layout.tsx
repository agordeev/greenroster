import "@/lib/runtime-env";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { MobileAuthBoundary } from "@/components/mobile-auth-boundary";
import { MobileAuthProvider } from "@/components/mobile-auth-provider";
import { MobileFirstRunBoundary } from "@/components/mobile-first-run-boundary";
import { MobileFirstRunProvider } from "@/components/mobile-first-run-provider";

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <MobileAuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <MobileAuthBoundary>
          <MobileFirstRunProvider>
            <MobileFirstRunBoundary>
              <Stack screenOptions={{ headerShown: false }} />
            </MobileFirstRunBoundary>
          </MobileFirstRunProvider>
        </MobileAuthBoundary>
      </ThemeProvider>
    </MobileAuthProvider>
  );
}
