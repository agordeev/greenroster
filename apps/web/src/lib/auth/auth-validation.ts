import { z } from "zod";

export const MINIMUM_PASSWORD_LENGTH = 8;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

export const recoverySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export const passwordResetSchema = z
  .object({
    password: z.string().min(MINIMUM_PASSWORD_LENGTH),
    confirmPassword: z.string().min(1),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export function authFieldErrors(error: z.ZodError) {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") (result[field] ??= []).push(issue.message);
  }

  return result;
}
