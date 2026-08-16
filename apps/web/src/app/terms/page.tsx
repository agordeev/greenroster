import Link from "next/link";

import { InformationShell } from "@/app/information-shell";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "@/lib/legal-documents";

export default function TermsPage() {
  return (
    <InformationShell kicker="Legal" title="Terms of Use">
      <div className="information-copy">
        <p className="status-note" role="status">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {TERMS_VERSION}
        </p>
        <p>
          You use GreenRoster to organize golf groups, rounds, invitations,
          scores, standings, and results.
        </p>
        <h2>You protect your account</h2>
        <ul>
          <li>You give accurate information when you create your account.</li>
          <li>
            You keep your password, sign-in links, and verification codes
            private.
          </li>
          <li>
            You contact support if someone uses your account without your
            permission.
          </li>
        </ul>
        <h2>You respect your group</h2>
        <ul>
          <li>
            You join only groups that invite you or that you are allowed to
            create.
          </li>
          <li>
            You follow your group&apos;s rules and enter RSVP choices and scores
            honestly.
          </li>
          <li>
            You do not misuse GreenRoster, disrupt another golfer&apos;s access,
            or upload unlawful content.
          </li>
          <li>
            You understand that an authorized coordinator can correct a score or
            reopen a round, and you see the resulting standings and results.
          </li>
        </ul>
        <h2>You choose your messages</h2>
        <p>
          You receive messages that your group needs to run rounds. You choose
          whether you receive optional e-mail and push messages in your
          notification choices.
        </p>
        <h2>You can leave</h2>
        <p>
          You can stop using GreenRoster at any time. You can request a copy of
          your information or request account deletion from{" "}
          <Link href="/account/privacy">Privacy requests</Link>.
        </p>
        <h2>You review changes</h2>
        <p>
          You review a new version of these Terms of Use when GreenRoster asks
          you to accept an update. You keep using GreenRoster only after you
          accept the current version.
        </p>
      </div>
    </InformationShell>
  );
}
