import { InformationShell } from "@/app/information-shell";
import { webRuntimeEnv } from "@/lib/runtime-env";

export default function FeedbackPage() {
  return (
    <InformationShell kicker="Feedback" title="Tell us what would work better">
      <div className="information-copy">
        <p>
          Include the workflow you were completing and the outcome you expected.
          Feedback is read through the support channel; it is not an in-app
          notification or group message.
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
