import { ResetForm } from "./reset-form";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";
import { AuthPanel, Kicker } from "@/components/blocks";

export default function ResetPasswordPage() {
  return (
    <AuthPanel titleId="reset-title">
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>One-time link</Kicker>
        <h1 id="reset-title">Choose a new password</h1>
        <p>Use a password of at least {MINIMUM_PASSWORD_LENGTH} characters.</p>
      </div>
      <ResetForm />
    </AuthPanel>
  );
}
