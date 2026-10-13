import { AuthForm } from "./auth-form";
import {
  ActionRow,
  BrandLockup,
  FormMessage,
  Kicker,
  SkipLink,
  TextLink,
} from "@/components/blocks";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";

type SignInPageProps = {
  searchParams: Promise<{ next?: string; status?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, status } = await searchParams;
  const returnPath = resolveSafeReturnPath(next);

  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen grid grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] max-[800px]:grid-cols-[1fr]"
      >
        <section
          className="p-[clamp(2rem,7vw,6rem)] flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 max-[480px]:[&_form_button[type=submit]]:w-full [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
          data-slot="auth-ledger"
          aria-labelledby="sign-in-title"
        >
          <BrandLockup className="mb-[clamp(3rem,9vh,6.5rem)] max-[800px]:mb-12" />

          <div className="max-w-136 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
            <Kicker>Welcome back</Kicker>
            <h1 id="sign-in-title">Sign in to GreenRoster</h1>
            <p>Sign in to see your rounds and standings.</p>
          </div>

          {status === "session-expired" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              You have been signed out. Sign in and try again.
            </FormMessage>
          ) : null}
          {status === "member-link-expired" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              That results link has expired or was already used. Ask your group
              coordinator to send a new results e-mail.
            </FormMessage>
          ) : null}
          {status === "member-link-unavailable" ? (
            <FormMessage className="mt-6 max-w-[30rem]" role="alert">
              We could not open that results link. Try the link again, or sign
              in with your account e-mail.
            </FormMessage>
          ) : null}

          <AuthForm returnPath={returnPath} />
          <ActionRow>
            <TextLink href="/sign-up">Create your group</TextLink>
          </ActionRow>
        </section>

        <aside
          className="relative flex flex-col justify-end overflow-hidden bg-primary p-[clamp(2rem,7vw,6rem)] text-primary-foreground max-[480px]:p-6"
          aria-label="About GreenRoster"
        >
          {/* Scorecard rules: nine columns, fading out above the headline. */}
          <div
            className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_10%,transparent_45%)] max-[800px]:hidden bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(100%/9-1px),rgb(255_255_255/0.07)_calc(100%/9-1px),rgb(255_255_255/0.07)_calc(100%/9))]"
            aria-hidden="true"
          />
          <div
            className="relative mb-auto h-1 w-16 animate-in bg-flag duration-700 slide-in-from-left-8 fade-in"
            aria-hidden="true"
          />
          <h2 className="relative mt-12 mb-0 max-w-136 animate-in text-[length:clamp(2rem,3.4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.02em] duration-700 fade-in slide-in-from-bottom-3">
            Your next round, recent results, and where you stand.
          </h2>
          <dl className="relative mt-12 mb-0 grid animate-in grid-cols-3 border-t border-primary-foreground/25 delay-150 duration-700 fill-mode-both fade-in slide-in-from-bottom-3 max-[480px]:grid-cols-1">
            {[
              ["Rounds", "RSVP for your next round"],
              ["Results", "See how you finished"],
              ["Standings", "Follow your quota and Order of Merit"],
            ].map(([term, detail]) => (
              <div
                key={term}
                className="border-primary-foreground/15 pt-4 pr-4 not-last:border-r not-first:pl-4 max-[480px]:border-r-0! max-[480px]:px-0! max-[480px]:py-3.5 max-[480px]:not-last:border-b"
              >
                <dt className="font-mono text-[0.6875rem] font-medium tracking-[0.16em] text-flag uppercase">
                  {term}
                </dt>
                <dd className="mt-1.5 ml-0 text-base leading-snug">{detail}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </main>
    </>
  );
}
