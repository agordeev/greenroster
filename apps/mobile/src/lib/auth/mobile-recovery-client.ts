import { z } from "zod";

const recoveryResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    correlationId: z.uuid(),
    ok: z.literal(true),
    recoveryHandle: z.string().min(43).optional(),
    state: z.enum(["active", "complete", "requested"]),
  }),
  z.object({
    code: z.enum([
      "authentication_required",
      "expired",
      "rate_limited",
      "unavailable",
      "validation",
    ]),
    correlationId: z.uuid(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    ok: z.literal(false),
  }),
]);

export type MobileRecoveryApiResult = z.infer<typeof recoveryResponseSchema>;

export function createMobileRecoveryClient(
  appUrl: string,
  fetchImplementation: typeof fetch = fetch,
) {
  async function request(
    path: "exchange" | "request" | "reset" | "status",
    options: Readonly<{
      body?: unknown;
      method: "GET" | "POST";
      recoveryHandle?: string;
    }>,
  ): Promise<MobileRecoveryApiResult> {
    try {
      const response = await fetchImplementation(
        `${appUrl}/api/auth/mobile-recovery/${path}`,
        {
          body: options.body ? JSON.stringify(options.body) : undefined,
          headers: {
            "Content-Type": "application/json",
            ...(options.recoveryHandle
              ? { Authorization: `Recovery ${options.recoveryHandle}` }
              : {}),
          },
          method: options.method,
        },
      );
      const parsed = recoveryResponseSchema.safeParse(await response.json());
      if (parsed.success) return parsed.data;
    } catch {
      // The caller maps transport failures to the same safe unavailable state.
    }

    return {
      code: "unavailable",
      correlationId: "00000000-0000-4000-8000-000000000000",
      ok: false,
    };
  }

  return {
    exchange(code: string, recoveryState: string) {
      return request("exchange", {
        body: { code, recoveryState },
        method: "POST",
      });
    },
    requestPasswordRecovery(email: string) {
      return request("request", { body: { email }, method: "POST" });
    },
    resetPassword(
      recoveryHandle: string,
      password: string,
      confirmPassword: string,
    ) {
      return request("reset", {
        body: { confirmPassword, password },
        method: "POST",
        recoveryHandle,
      });
    },
    status(recoveryHandle: string) {
      return request("status", { method: "GET", recoveryHandle });
    },
  };
}
