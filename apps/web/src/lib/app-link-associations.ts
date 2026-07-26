type Environment = Readonly<Record<string, string | undefined>>;

const bundleIdentifier = "com.greenroster.app";
const linkedPaths = ["/", "/rounds", "/leaderboard", "/profile"] as const;

function requiredValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  if (value.startsWith("replace-with-")) {
    throw new Error(`Replace placeholder environment variable: ${name}`);
  }
  return value;
}

export function createAppLinkAssociations(environment: Environment) {
  const applePrefix = requiredValue(
    environment,
    "APPLE_APP_IDENTIFIER_PREFIX",
  ).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(applePrefix)) {
    throw new Error(
      "APPLE_APP_IDENTIFIER_PREFIX must be a 10-character identifier",
    );
  }

  const androidFingerprint = requiredValue(
    environment,
    "ANDROID_APP_CERTIFICATE_SHA256",
  ).toUpperCase();
  if (!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(androidFingerprint)) {
    throw new Error(
      "ANDROID_APP_CERTIFICATE_SHA256 must be a colon-delimited SHA-256 fingerprint",
    );
  }

  return Object.freeze({
    android: {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: bundleIdentifier,
        sha256_cert_fingerprints: [androidFingerprint],
      },
    },
    apple: {
      applinks: {
        apps: [],
        details: [
          {
            appID: `${applePrefix}.${bundleIdentifier}`,
            paths: [...linkedPaths],
          },
        ],
      },
    },
  });
}
