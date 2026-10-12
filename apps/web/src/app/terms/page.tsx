import Link from "next/link";

import { InformationShell } from "@/app/information-shell";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "@/lib/legal-documents";
import { FormMessage } from "@/components/blocks";

export default function TermsPage() {
  return (
    <InformationShell kicker="Legal" title="Terms of Use">
      <div className="information-copy">
        <FormMessage tone="info" className="mb-6" role="status">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {TERMS_VERSION}
        </FormMessage>
        <p>
          GreenRoster is for organizing golf groups, rounds, invitations,
          scores, standings, and results. These are the terms for using it.
        </p>
        <h2>Your account</h2>
        <ul>
          <li>Give accurate information when you create your account.</li>
          <li>
            Keep your password, sign-in links, and verification codes private.
          </li>
          <li>
            Contact support if someone uses your account without your
            permission.
          </li>
        </ul>
        <h2>Your group</h2>
        <ul>
          <li>
            Join only groups that invite you or that you are allowed to create.
          </li>
          <li>
            Follow your group&apos;s rules, and enter your RSVPs and scores
            honestly.
          </li>
          <li>
            Don&apos;t misuse GreenRoster, disrupt another golfer&apos;s access,
            or upload unlawful content.
          </li>
          <li>
            A coordinator can correct a score or reopen a round. Standings and
            results update to match.
          </li>
        </ul>
        <h2>Messages</h2>
        <p>
          We send the messages your group needs to run rounds. You choose
          whether to get optional e-mail and push messages in your notification
          preferences.
        </p>
        <h2>Leaving</h2>
        <p>
          You can stop using GreenRoster at any time. To get a copy of your
          information or delete your account, go to{" "}
          <Link href="/account/privacy">Privacy requests</Link>.
        </p>
        <h2>Changes to these terms</h2>
        <p>
          When these Terms of Use change, we ask you to accept the new version.
          You need to accept it to keep using GreenRoster.
        </p>
      </div>
    </InformationShell>
  );
}
