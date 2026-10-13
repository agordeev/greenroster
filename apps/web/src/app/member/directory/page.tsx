import { redirect } from "next/navigation";
import Link from "next/link";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberDirectory } from "@/lib/member/member-directory-data";
import {
  Kicker,
  SkipLink,
  standalonePageWideClass,
  standalonePanelClass,
  TextLink,
} from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemberNav } from "../member-nav";

type MemberDirectoryPageProps = Readonly<{
  searchParams: Promise<{
    search?: string | string[];
    alphabet?: string | string[];
  }>;
}>;

export default async function MemberDirectoryPage({
  searchParams,
}: MemberDirectoryPageProps) {
  const params = await searchParams;
  const search = Array.isArray(params.search)
    ? (params.search[0] ?? "")
    : (params.search ?? "");
  const alphabetValue = Array.isArray(params.alphabet)
    ? params.alphabet[0]
    : params.alphabet;
  const alphabet =
    alphabetValue && /^[A-Z]$/u.test(alphabetValue) ? alphabetValue : null;

  const access = await resolveMemberPageSession();
  if (access.state === "authentication_required") {
    redirect(signInPath("/member/directory"));
  }
  if (access.state === "recovery_active") redirect("/reset-password");
  if (access.state === "role_redirect") redirect("/portal");
  if (access.state !== "ready") return <MemberDirectoryUnavailable />;

  let directory;
  try {
    directory = await executeReadMemberDirectory(
      access.client,
      search,
      alphabet,
    );
  } catch {
    return <MemberDirectoryUnavailable />;
  }

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className={standalonePageWideClass}>
        <section
          className={standalonePanelClass}
          data-slot="auth-ledger"
          aria-labelledby="member-directory-title"
        >
          <MemberNav current="directory" />
          <div className="max-w-168 [&>p:last-child]:text-muted-foreground [&>p:last-child]:leading-[1.65] [&_h1]:mx-0 [&_h1]:mt-2 [&_h1]:mb-3.5 [&_h1]:text-[length:clamp(2rem,4vw,3rem)] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.1] [&_p]:m-0">
            <Kicker>{directory.group.name}</Kicker>
            <h1 id="member-directory-title">Member directory</h1>
            <form
              className="mt-5 gap-3 flex items-end max-[720px]:flex-col max-[720px]:items-stretch [&_:is([data-slot=field],[data-slot='field'])]:flex-1"
              method="get"
            >
              <label
                className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
                data-slot="field"
                htmlFor="member-directory-search"
              >
                <span>Search the directory</span>
                <Input
                  id="member-directory-search"
                  name="search"
                  defaultValue={search}
                  maxLength={200}
                  placeholder="Search by name"
                />
              </label>
              <Button variant="outline" type="submit">
                Search members
              </Button>
            </form>
            <nav
              className="mt-5 gap-[0.35rem] flex flex-wrap [&_a:hover]:border-primary [&_a:hover]:text-primary [&_a[data-active]]:border-primary [&_a[data-active]]:text-primary [&_a]:py-[0.45rem] [&_a]:px-[0.55rem] [&_a]:border [&_a]:min-w-8 [&_a]:text-muted-foreground [&_a]:text-[0.75rem] [&_a]:text-center [&_a]:no-underline"
              aria-label="Surname letters"
            >
              <Link
                data-active={!alphabet ? "" : undefined}
                href="/member/directory"
              >
                All members
              </Link>
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
                <Link
                  data-active={alphabet === letter ? "" : undefined}
                  href={`/member/directory?alphabet=${letter}`}
                  key={letter}
                >
                  {letter}
                </Link>
              ))}
            </nav>
            {directory.members.length === 0 ? (
              <p className="text-muted-foreground leading-[1.55]">
                No members match this search.
              </p>
            ) : (
              <div className="mt-6 gap-3 grid">
                {directory.members.map((member) => (
                  <article
                    className="p-5 gap-5 border grid grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] rounded-lg max-[720px]:grid-cols-[1fr] [&_a]:text-primary! [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:text-[0.8125rem] [&_dd]:wrap-anywhere [&_dl]:m-0 [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-y-[0.85rem] [&_dl]:gap-x-4 max-[720px]:[&_dl]:grid-cols-[1fr]! [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase [&_h2]:mx-0 [&_h2]:mt-[0.35rem] [&_h2]:mb-0 [&_h2]:text-[1.25rem] [&_h2]:font-semibold"
                    key={member.membershipId}
                  >
                    <div>
                      <h2>{displayName(member.firstName, member.lastName)}</h2>
                      <p className="mx-0 mt-[0.4rem] mb-0 text-muted-foreground text-[0.8125rem]">
                        {member.teeLocation
                          ? `${member.teeLocation} tee`
                          : "Tee not listed"}
                      </p>
                    </div>
                    <dl>
                      {member.secondaryEmail ? (
                        <div>
                          <dt>E-mail</dt>
                          <dd>
                            <a href={`mailto:${member.secondaryEmail}`}>
                              {member.secondaryEmail}
                            </a>
                          </dd>
                        </div>
                      ) : null}
                      {member.mobilePhone ? (
                        <div>
                          <dt>Mobile</dt>
                          <dd>
                            <a href={`tel:${member.mobilePhone}`}>
                              {member.mobilePhone}
                            </a>
                          </dd>
                        </div>
                      ) : null}
                      {member.homePhone ? (
                        <div>
                          <dt>Home</dt>
                          <dd>{member.homePhone}</dd>
                        </div>
                      ) : null}
                      {member.workPhone ? (
                        <div>
                          <dt>Work</dt>
                          <dd>{member.workPhone}</dd>
                        </div>
                      ) : null}
                      {member.address?.city || member.address?.stateRegion ? (
                        <div>
                          <dt>Address</dt>
                          <dd>{formatAddress(member.address)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function displayName(firstName: string, lastName: string) {
  return [firstName, lastName].filter(Boolean).join(" ") || "Unnamed member";
}

function formatAddress(
  address: NonNullable<
    Awaited<ReturnType<typeof executeReadMemberDirectory>>["members"]
  >[number]["address"],
) {
  if (!address) return "Address not listed";
  return [address.city, address.stateRegion, address.country]
    .filter(Boolean)
    .join(", ");
}

function MemberDirectoryUnavailable() {
  return (
    <main className={standalonePageWideClass}>
      <section
        className={standalonePanelClass}
        data-slot="auth-ledger"
        aria-labelledby="member-directory-error-title"
      >
        <Kicker>Your group directory</Kicker>
        <h1 id="member-directory-error-title">
          We couldn’t load the directory
        </h1>
        <p>Refresh this page and try again.</p>
        <TextLink href="/member/home">Home</TextLink>
      </section>
    </main>
  );
}
