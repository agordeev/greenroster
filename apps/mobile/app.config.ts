import { loadProjectEnv } from "@expo/env";
import type { ConfigContext, ExpoConfig } from "expo/config";

const linkedPaths = [
  "/",
  "/rounds",
  "/leaderboard",
  "/profile",
  "/notification-preferences",
] as const;

loadProjectEnv(process.cwd(), { silent: true });

function requiredAppOrigin(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      "Missing required environment variable: EXPO_PUBLIC_APP_URL",
    );
  }

  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== configured ||
      url.pathname !== "/"
    ) {
      throw new Error("invalid origin");
    }
  } catch {
    throw new Error("EXPO_PUBLIC_APP_URL must be a valid HTTP or HTTPS origin");
  }

  return configured;
}

export function createGreenRosterExpoConfig(
  config: Partial<ExpoConfig>,
  appOrigin: string,
): ExpoConfig {
  if (!config.name || !config.slug) {
    throw new Error("Expo base config must define name and slug");
  }

  const url = new URL(appOrigin);
  const isHttps = url.protocol === "https:";
  if (isHttps && url.port && url.port !== "443") {
    throw new Error("HTTPS application links require the default port");
  }

  return {
    ...config,
    name: config.name,
    slug: config.slug,
    ios: {
      ...config.ios,
      associatedDomains: isHttps ? [`applinks:${url.hostname}`] : undefined,
    },
    android: {
      ...config.android,
      intentFilters: isHttps
        ? [
            {
              action: "VIEW",
              autoVerify: true,
              category: ["BROWSABLE", "DEFAULT"],
              data: linkedPaths.map((path) => ({
                scheme: "https",
                host: url.hostname,
                path,
              })),
            },
          ]
        : undefined,
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  return createGreenRosterExpoConfig(
    config,
    requiredAppOrigin(process.env.EXPO_PUBLIC_APP_URL),
  );
};
