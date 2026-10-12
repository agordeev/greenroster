import { InformationShell } from "@/app/information-shell";
import { Button } from "@/components/ui/button";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function SupportPage() {
  return (
    <InformationShell kicker="Support" title="Contact GreenRoster support">
      <div className="information-copy">
        <p>
          Tell us what you were doing, when it happened, and the exact message
          you saw. Never include your password or a recovery link.
        </p>
        <Button asChild className="mt-6">
          <a
            href={`mailto:${webRuntimeEnv.supportEmail}?subject=${encodeURIComponent("GreenRoster support request")}`}
          >
            E-mail {webRuntimeEnv.supportEmail}
          </a>
        </Button>
      </div>
    </InformationShell>
  );
}
