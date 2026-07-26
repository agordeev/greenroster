import "@/lib/runtime-env";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { MobileAuthBoundary } from "@/components/mobile-auth-boundary";
import { MobileAuthProvider } from "@/components/mobile-auth-provider";

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <MobileAuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <MobileAuthBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </MobileAuthBoundary>
      </ThemeProvider>
    </MobileAuthProvider>
  );
}
