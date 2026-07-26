import { InformationShell } from "@/app/information-shell";

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
      </div>
    </InformationShell>
  );
}
