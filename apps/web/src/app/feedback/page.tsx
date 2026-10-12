import { InformationShell } from "@/app/information-shell";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function FeedbackPage() {
  return (
    <InformationShell kicker="Feedback" title="Tell us what would work better">
      <div className="information-copy">
        <p>
          Tell us what you were doing and what you expected to happen. Feedback
          goes to GreenRoster support, not to your group.
        </p>
        <a
          className="primary-link"
          href={`mailto:${webRuntimeEnv.supportEmail}?subject=${encodeURIComponent("GreenRoster product feedback")}`}
        >
          Send feedback by e-mail
        </a>
      </div>
    </InformationShell>
  );
}
