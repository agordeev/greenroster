type Environment = Readonly<Record<string, string | undefined>>;

function requiredValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (value.startsWith("replace-with-")) {
    throw new Error(`Replace placeholder environment variable: ${name}`);
  }

  return value;
}

function requiredHttpUrl(environment: Environment, name: string): string {
  const value = requiredValue(environment, name);

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }

  return value;
}

function requiredOrigin(environment: Environment, name: string): string {
  const value = requiredHttpUrl(environment, name);
  const url = new URL(value);

  if (url.origin !== value || url.pathname !== "/") {
    throw new Error(`${name} must be an HTTP or HTTPS origin`);
  }

  return value;
}

export function validateMobileRuntimeEnv(environment: Environment) {
  return Object.freeze({
    appUrl: requiredOrigin(environment, "EXPO_PUBLIC_APP_URL"),
    supabaseUrl: requiredHttpUrl(environment, "EXPO_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: requiredValue(
      environment,
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  });
}
