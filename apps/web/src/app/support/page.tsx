import { InformationShell } from "@/app/information-shell";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function SupportPage() {
  return (
    <InformationShell kicker="Support" title="Contact GreenRoster support">
      <div className="information-copy">
        <p>
          Describe what you were doing, the time it happened, and the exact
          message shown. Never include your password or a recovery link.
        </p>
        <a
          className="primary-link"
          href={`mailto:${webRuntimeEnv.supportEmail}?subject=${encodeURIComponent("GreenRoster support request")}`}
        >
          E-mail {webRuntimeEnv.supportEmail}
        </a>
      </div>
    </InformationShell>
  );
}
