import { Prose } from "@/components/blocks";
import { InformationShell } from "@/app/information-shell";
import { Button } from "@/components/ui/button";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function FeedbackPage() {
  return (
    <InformationShell kicker="Feedback" title="Tell us what would work better">
      <Prose>
        <p>
          Tell us what you were doing and what you expected to happen. Feedback
          goes to GreenRoster support, not to your group.
        </p>
        <Button asChild className="mt-6">
          <a
            href={`mailto:${webRuntimeEnv.supportEmail}?subject=${encodeURIComponent("GreenRoster product feedback")}`}
          >
            Send feedback by e-mail
          </a>
        </Button>
      </Prose>
    </InformationShell>
  );
}
