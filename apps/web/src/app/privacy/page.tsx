import { InformationShell } from "@/app/information-shell";
import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, PRIVACY_VERSION } from "@/lib/legal-documents";
import { Prose } from "@/components/blocks";
import { Button } from "@/components/ui/button";

export default function PrivacyPage() {
  return (
    <InformationShell kicker="Legal" title="Privacy Policy">
      <Prose>
        <p className="mb-6 font-mono text-[0.6875rem] text-muted-foreground">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {PRIVACY_VERSION}
        </p>
        <p>
          To use GreenRoster you share some information with us: your account
          e-mail, name, group membership, RSVPs, scores, results, and any
          optional directory details you add.
        </p>
        <h2>How we use your information</h2>
        <ul>
          <li>
            We use it to give you account access, invitations, round updates,
            standings, and results.
          </li>
          <li>
            If you turn on notifications in the app, we save the device
            information needed to deliver push messages.
          </li>
          <li>
            We send optional messages only when your notification preferences
            allow them.
          </li>
          <li>
            Your coordinators use group information to run rounds, and you see
            the group information they share with you.
          </li>
        </ul>
        <h2>Your choices</h2>
        <ul>
          <li>
            You can change your profile details and notification preferences in
            GreenRoster.
          </li>
          <li>
            You can request a copy of your information, or ask us to delete your
            account, from the privacy requests link below.
          </li>
          <li>
            After your account details are removed, we keep the scores, results,
            and change history your group needs to preserve its results.
          </li>
        </ul>
        <h2>How long we keep information</h2>
        <p>
          When we complete an approved deletion request, we remove or anonymize
          your account and contact details. We remove expired invitations after
          30 days and completed message delivery history after 90 days.
        </p>
        <h2>Questions</h2>
        <p>
          If you have a question about your information, contact us from the{" "}
          <Link href="/support">support page</Link>.
        </p>
        <Button asChild className="mt-6">
          <Link href="/account/privacy">Open privacy requests</Link>
        </Button>
      </Prose>
    </InformationShell>
  );
}
