import Link from "next/link";

import { resolveCurrentLegalDocuments } from "@/lib/auth/organizer-signup-data";
import { parseSignupSource } from "@/lib/auth/signup-source";

import { OrganizerSignupForm } from "./signup-form";
import { AuthPanel, FormMessage, Kicker, TextLink } from "@/components/blocks";

type SignupPageProps = {
  searchParams: Promise<{ status?: string; from?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { status, from } = await searchParams;
  const legal = await resolveCurrentLegalDocuments().catch(() => null);

  return (
    <AuthPanel titleId="sign-up-title">
      <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
        <Kicker>New group</Kicker>
        <h1 id="sign-up-title">Start your group</h1>
        <p>Create your account, then set up your group.</p>
      </div>

      {status === "auth-unavailable" ? (
        <FormMessage className="mt-6 max-w-[30rem]" role="alert">
          We couldn&apos;t create your account. Try again in a moment.
        </FormMessage>
      ) : status === "expired" ? (
        <FormMessage className="mt-6 max-w-[30rem]" role="alert">
          Your verification link has expired. Start again to receive a new link.
        </FormMessage>
      ) : null}

      {legal ? (
        <OrganizerSignupForm source={parseSignupSource(from)} />
      ) : (
        <FormMessage className="mt-6 max-w-[30rem]" tone="info" role="status">
          <p>You can&apos;t start a new group right now.</p>
          <p>
            If you already belong to a group, sign in to see your rounds. If
            this keeps happening,{" "}
            <Link
              href="/support"
              className="font-bold text-primary underline underline-offset-[0.2em]"
            >
              contact support
            </Link>
            .
          </p>
        </FormMessage>
      )}

      <TextLink href="/sign-in">Sign in instead</TextLink>
    </AuthPanel>
  );
}
