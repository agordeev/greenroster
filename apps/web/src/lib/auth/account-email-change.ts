import { z } from "zod";

import { MutationError } from "../mutations/result";

const accountEmailSchema = z
  .string()
  .trim()
  .max(320)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

const inputSchema = z
  .object({
    email: accountEmailSchema,
    confirmed: z.literal(true),
  })
  .strict();

export type AccountEmailChangeState = Readonly<{
  status: "idle" | "error" | "verification_pending";
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export const initialAccountEmailChangeState: AccountEmailChangeState = {
  status: "idle",
  message: "",
};

type AccountEmailRequestResult = Readonly<{
  currentEmail: string;
  userId: string;
}>;

export type AccountEmailChangeDependencies = Readonly<{
  requestChange(email: string): Promise<AccountEmailRequestResult>;
  verifySession(): Promise<Readonly<{ userId: string }>>;
}>;

export async function runAccountEmailChange(
  input: unknown,
  dependencies: AccountEmailChangeDependencies,
): Promise<AccountEmailChangeState> {
  let session: Awaited<ReturnType<typeof dependencies.verifySession>>;
  try {
    session = await dependencies.verifySession();
  } catch (error) {
    return mutationErrorState(error);
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  try {
    const result = await dependencies.requestChange(parsed.data.email);
    if (result.userId !== session.userId) {
      throw new MutationError("authentication_required");
    }
    if (result.currentEmail.toLowerCase() === parsed.data.email) {
      return {
        status: "error",
        message: "Enter a different account e-mail.",
        fieldErrors: { email: ["Enter a different account e-mail."] },
      };
    }
  } catch (error) {
    return mutationErrorState(error);
  }

  return {
    status: "verification_pending",
    message:
      "We sent confirmation messages. Your account e-mail won't change until you follow the links in them.",
  };
}

function mutationErrorState(error: unknown): AccountEmailChangeState {
  const code = error instanceof MutationError ? error.code : "unexpected";
  if (code === "authentication_required") {
    return {
      status: "error",
      message: "You've been signed out. Sign in again, then submit the change.",
    };
  }
  if (code === "rate_limited") {
    return {
      status: "error",
      message: "Too many attempts. Wait a moment and try again.",
    };
  }
  if (code === "forbidden") {
    return {
      status: "error",
      message:
        "You can't change your account e-mail during a password reset. Sign in normally, then submit the change again.",
    };
  }
  if (code === "validation") {
    return {
      status: "error",
      message:
        "That e-mail address can't be used for your account. Try a different one.",
      fieldErrors: { email: ["Enter another account e-mail."] },
    };
  }
  if (code === "transient") {
    return {
      status: "error",
      message:
        "We couldn't update your account e-mail right now. Check your connection and try again.",
    };
  }
  return {
    status: "error",
    message: "We couldn't start the e-mail change. Try again.",
  };
}
