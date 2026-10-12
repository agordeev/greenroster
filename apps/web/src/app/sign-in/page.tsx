import { AuthForm } from "./auth-form";
import {
  ActionRow,
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
          className="p-[clamp(2rem,7vw,6rem)] border-r flex min-h-screen flex-col justify-center bg-card max-[800px]:border-r-0 max-[800px]:min-h-auto max-[480px]:p-6 [&>[data-slot=text-link]]:mt-5 [&>[data-slot=text-link]]:inline-block"
          data-slot="auth-ledger"
          aria-labelledby="sign-in-title"
        >
          <div className="mb-[clamp(3rem,9vh,6.5rem)] gap-3.5 flex items-center max-[800px]:mb-12">
            <span
              className="border border-primary grid w-12 h-12 place-items-center rounded-full text-primary text-[0.875rem] font-bold tracking-[0.08em]"
              aria-hidden="true"
            >
              GR
            </span>
            <div>
              <p className="m-0 text-[1.125rem] font-bold">GreenRoster</p>
              <p className="mx-0 mt-0.5 mb-0 text-muted-foreground text-[0.8125rem]">
                Your group. Your rounds. One roster.
              </p>
            </div>
          </div>

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
          className="p-[clamp(2rem,7vw,6rem)] flex flex-col justify-end bg-background max-[800px]:border-t max-[800px]:min-h-120 max-[480px]:p-6 [&>p]:max-w-136 [&>p]:text-muted-foreground [&>p]:leading-[1.65] [&_dd]:mx-0 [&_dd]:mt-1.5 [&_dd]:mb-0 [&_dd]:text-[1rem] [&_dl]:mx-0 [&_dl]:mt-12 [&_dl]:mb-0 [&_dl]:border-t [&_dl]:grid [&_dl]:grid-cols-[repeat(3,1fr)] max-[480px]:[&_dl]:grid-cols-[1fr]! [&_dl_div]:pt-4 [&_dl_div]:pr-3 [&_dl_div]:pb-0 [&_dl_div]:pl-0 [&_dl_div]:border-r [&_dl_div]:border-r-border/50 max-[480px]:[&_dl_div]:pl-0 max-[480px]:[&_dl_div]:border-b max-[480px]:[&_dl_div]:border-b-border/50 max-[480px]:[&_dl_div]:py-3.5! max-[480px]:[&_dl_div]:pr-0! max-[480px]:[&_dl_div]:border-r-0! [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.1em] [&_dt]:uppercase [&_h2]:mx-0 [&_h2]:mt-3 [&_h2]:mb-4 [&_h2]:max-w-120 [&_h2]:text-[length:clamp(2rem,4vw,3.5rem)] [&_h2]:font-semibold [&_h2]:tracking-[-0.03em] [&_h2]:leading-[1.05] [&_p]:m-0"
          aria-label="About GreenRoster"
        >
          <div className="mb-auto w-16 h-1 bg-primary" />
          <h2>Your next round, recent results, and where you stand.</h2>
          <dl>
            <div>
              <dt>Rounds</dt>
              <dd>RSVP for your next round</dd>
            </div>
            <div>
              <dt>Results</dt>
              <dd>See how you finished</dd>
            </div>
            <div>
              <dt>Standings</dt>
              <dd>Follow your quota and Order of Merit</dd>
            </div>
          </dl>
        </aside>
      </main>
    </>
  );
}
