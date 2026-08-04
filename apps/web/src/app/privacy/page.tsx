import { InformationShell } from "@/app/information-shell";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <InformationShell kicker="Legal" title="Privacy Policy">
      <div className="information-copy">
        <p className="status-note" role="status">
          The release Privacy Policy is awaiting approval from the named legal
          and privacy owner.
        </p>
        <p>
          GreenRoster will display the approved document and version here before
          production release. Account acceptance is stored with that exact
          version and a server timestamp; this page does not record acceptance.
        </p>
        <p>
          Authenticated users can request data access or account deletion from
          the protected privacy request page. The named privacy owner handles
          requests through the support process.
        </p>
        <Link className="primary-link" href="/account/privacy">
          Open privacy requests
        </Link>
      </div>
    </InformationShell>
  );
}
