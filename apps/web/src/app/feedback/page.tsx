import { InformationShell } from "@/app/information-shell";
import { Button } from "@/components/ui/button";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function FeedbackPage() {
  return (
    <InformationShell kicker="Feedback" title="Tell us what would work better">
      <div className="max-w-168 text-muted-foreground leading-[1.65] [&_h2]:mx-0 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-foreground [&_h2]:text-[1.5rem] [&_h2]:font-semibold">
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
      </div>
    </InformationShell>
  );
}
