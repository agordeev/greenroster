import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`Missing required billing environment variable: ${name}`);
  if (value.startsWith("replace-with-")) {
    throw new Error(
      `Replace placeholder billing environment variable: ${name}`,
    );
  }
  return value;
}

function requiredHttpUrl(environment: Environment, name: string): string {
  const value = required(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
  return value.replace(/\/$/, "");
}

function requiredSecret(
  environment: Environment,
  name: string,
  prefix?: string,
): string {
  const value = required(environment, name);
  if (prefix && !value.startsWith(prefix)) {
    throw new Error(`${name} must start with ${prefix}`);
  }
  if (Buffer.byteLength(value, "utf8") < 16) {
    throw new Error(`${name} must contain at least 16 bytes`);
  }
  return value;
}

export function validateBillingRuntimeEnv(environment: Environment) {
  return Object.freeze({
    secretKey: requiredSecret(environment, "STRIPE_SECRET_KEY", "sk_"),
    webhookSecret: requiredSecret(
      environment,
      "STRIPE_WEBHOOK_SECRET",
      "whsec_",
    ),
    priceId: required(environment, "STRIPE_PRICE_ID"),
    apiBaseUrl: requiredHttpUrl(
      {
        STRIPE_API_BASE_URL:
          environment.STRIPE_API_BASE_URL ?? "https://api.stripe.com",
      },
      "STRIPE_API_BASE_URL",
    ),
    webhookToleranceSeconds: parseTolerance(
      environment.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    ),
  });
}

function parseTolerance(value: string | undefined): number {
  const raw = value?.trim() || "300";
  if (!/^\d+$/.test(raw))
    throw new Error(
      "STRIPE_WEBHOOK_TOLERANCE_SECONDS must be a positive integer",
    );
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 900) {
    throw new Error(
      "STRIPE_WEBHOOK_TOLERANCE_SECONDS must be between 1 and 900",
    );
  }
  return parsed;
}

export function readBillingRuntimeEnv() {
  return validateBillingRuntimeEnv({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
    STRIPE_API_BASE_URL: process.env.STRIPE_API_BASE_URL,
    STRIPE_WEBHOOK_TOLERANCE_SECONDS:
      process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  });
}
