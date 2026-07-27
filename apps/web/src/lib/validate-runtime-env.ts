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

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP or HTTPS origin`);
  }

  return url.origin;
}

function requiredEmail(environment: Environment, name: string): string {
  const value = requiredValue(environment, name).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${name} must be a valid e-mail address`);
  }

  return value;
}

function requiredSecret(
  environment: Environment,
  name: string,
  minimumBytes: number,
): string {
  const value = requiredValue(environment, name);

  if (Buffer.byteLength(value, "utf8") < minimumBytes) {
    throw new Error(`${name} must contain at least ${minimumBytes} bytes`);
  }

  return value;
}

function requiredPositiveInteger(
  environment: Environment,
  name: string,
): number {
  const value = requiredValue(environment, name);

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return number;
}

function requiredPrefixedSecret(
  environment: Environment,
  name: string,
  prefix: string,
): string {
  const value = requiredValue(environment, name);

  if (!value.startsWith(prefix) || Buffer.byteLength(value, "utf8") < 16) {
    throw new Error(`${name} must be a valid ${prefix} secret`);
  }

  return value;
}

export function validateWebRuntimeEnv(environment: Environment) {
  const invitationTtlHours = requiredPositiveInteger(
    environment,
    "INVITATION_TTL_HOURS",
  );
  const maximumInvitationTtlHours = Math.floor(
    Number.MAX_SAFE_INTEGER / (60 * 60 * 1000),
  );

  if (invitationTtlHours > maximumInvitationTtlHours) {
    throw new Error("INVITATION_TTL_HOURS must be a positive integer");
  }

  const notificationEmailMaxAttempts = requiredPositiveInteger(
    environment,
    "NOTIFICATION_EMAIL_MAX_ATTEMPTS",
  );
  const notificationEmailRetrySeconds = requiredPositiveInteger(
    environment,
    "NOTIFICATION_EMAIL_RETRY_SECONDS",
  );

  return Object.freeze({
    appUrl: requiredOrigin(environment, "APP_URL"),
    supportEmail: requiredEmail(environment, "SUPPORT_EMAIL"),
    supabaseUrl: requiredHttpUrl(environment, "NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: requiredValue(
      environment,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    supabaseSecretKey: requiredValue(environment, "SUPABASE_SECRET_KEY"),
    invitationTokenSecret: requiredSecret(
      environment,
      "INVITATION_TOKEN_SECRET",
      32,
    ),
    invitationTtlHours,
    invitationTtlMilliseconds: invitationTtlHours * 60 * 60 * 1000,
    resendApiKey: requiredPrefixedSecret(environment, "RESEND_API_KEY", "re_"),
    resendFromEmail: requiredEmail(environment, "RESEND_FROM_EMAIL"),
    resendWebhookSecret: requiredPrefixedSecret(
      environment,
      "RESEND_WEBHOOK_SECRET",
      "whsec_",
    ),
    cronSecret: requiredSecret(environment, "CRON_SECRET", 32),
    notificationEmailMaxAttempts,
    notificationEmailRetrySeconds,
  });
}
