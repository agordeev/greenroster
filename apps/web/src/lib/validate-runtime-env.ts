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

export function validateWebRuntimeEnv(environment: Environment) {
  return Object.freeze({
    supabaseUrl: requiredHttpUrl(environment, "NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: requiredValue(
      environment,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    supabaseSecretKey: requiredValue(environment, "SUPABASE_SECRET_KEY"),
  });
}
