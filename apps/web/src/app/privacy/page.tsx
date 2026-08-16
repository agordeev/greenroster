import { InformationShell } from "@/app/information-shell";
import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, PRIVACY_VERSION } from "@/lib/legal-documents";

export default function PrivacyPage() {
  return (
    <InformationShell kicker="Legal" title="Privacy Policy">
      <div className="information-copy">
        <p className="status-note" role="status">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {PRIVACY_VERSION}
        </p>
        <p>
          You share the information that you need to use GreenRoster, including
          your account e-mail, name, group membership, RSVP choices, scores,
          results, and any optional directory details you add.
        </p>
        <h2>You see how GreenRoster uses your information</h2>
        <ul>
          <li>
            You get account access, invitations, round updates, standings, and
            results from the information you provide.
          </li>
          <li>
            You receive push messages when you enable mobile notifications, and
            you allow the app to save the device information needed to deliver
            them.
          </li>
          <li>
            You receive optional messages only when your notification choices
            allow them.
          </li>
          <li>
            You see the group information your coordinator shares with you, and
            you understand that coordinators use group information to run
            rounds.
          </li>
        </ul>
        <h2>You keep control of your information</h2>
        <ul>
          <li>
            You change the profile and notification choices that GreenRoster
            lets you edit.
          </li>
          <li>
            You request a copy of your information or request account deletion
            through the privacy request links below.
          </li>
          <li>
            You understand that GreenRoster keeps the sporting and audit history
            needed to preserve group results after direct account details are
            removed.
          </li>
        </ul>
        <h2>You see how long information stays</h2>
        <p>
          You get direct account and contact details removed or anonymized when
          you complete an approved deletion request. You see expired invitations
          removed after 30 days and completed message delivery history removed
          after 90 days.
        </p>
        <h2>You can ask questions</h2>
        <p>
          You can contact support from the{" "}
          <Link href="/support">support page</Link> if you have a question about
          your information.
        </p>
        <Link className="primary-link" href="/account/privacy">
          Open privacy requests
        </Link>
      </div>
    </InformationShell>
  );
}
