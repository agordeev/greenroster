import { redirect } from "next/navigation";
import Link from "next/link";

import { resolveMemberPageSession } from "@/lib/auth/member-page-session";
import { signInPath } from "@/lib/auth/safe-return-path";
import { executeReadMemberDirectory } from "@/lib/member/member-directory-data";

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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell auth-shell-single invitation-shell"
      >
        <section
          className="auth-ledger"
          aria-labelledby="member-directory-title"
        >
          <nav className="member-results-nav" aria-label="Member navigation">
            <Link className="secondary-link" href="/member/home">
              You open your home
            </Link>
            <Link className="secondary-link" href="/member/profile">
              You open your profile
            </Link>
          </nav>
          <div className="auth-heading">
            <p className="ledger-kicker">Your group directory</p>
            <h1 id="member-directory-title">{directory.group.name}</h1>
            <p className="member-home-intro">
              You see the contact details that each member chooses to share.
            </p>
            <form className="member-directory-filter" method="get">
              <label className="field-group" htmlFor="member-directory-search">
                <span>You search the directory</span>
                <input
                  id="member-directory-search"
                  name="search"
                  defaultValue={search}
                  maxLength={200}
                  placeholder="Search by name"
                />
              </label>
              <button className="secondary-button" type="submit">
                Search members
              </button>
            </form>
            <nav
              className="member-directory-letters"
              aria-label="Surname letters"
            >
              <Link
                className={!alphabet ? "active" : ""}
                href="/member/directory"
              >
                All members
              </Link>
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
                <Link
                  className={alphabet === letter ? "active" : ""}
                  href={`/member/directory?alphabet=${letter}`}
                  key={letter}
                >
                  {letter}
                </Link>
              ))}
            </nav>
            {directory.members.length === 0 ? (
              <p className="member-read-empty">
                You see no members for this search.
              </p>
            ) : (
              <div className="member-directory-list">
                {directory.members.map((member) => (
                  <article
                    className="member-directory-card"
                    key={member.membershipId}
                  >
                    <div>
                      <p className="ledger-kicker">Member</p>
                      <h2>{displayName(member.firstName, member.lastName)}</h2>
                      <p className="member-directory-meta">
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
    <main className="auth-shell auth-shell-single invitation-shell">
      <section
        className="auth-ledger"
        aria-labelledby="member-directory-error-title"
      >
        <p className="ledger-kicker">Your group directory</p>
        <h1 id="member-directory-error-title">
          You can’t open the directory right now
        </h1>
        <p>You refresh this page and try again.</p>
        <Link className="secondary-link" href="/member/home">
          You open your home
        </Link>
      </section>
    </main>
  );
}
