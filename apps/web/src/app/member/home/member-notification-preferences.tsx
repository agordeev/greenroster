import { Kicker } from "@/components/blocks";
export type MemberNotificationPreference = Readonly<{
  category: string;
  mandatory: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  email_allowed: boolean;
  push_allowed: boolean;
}>;

export function MemberNotificationPreferences({
  preferences,
}: Readonly<{
  preferences: readonly MemberNotificationPreference[] | null;
}>) {
  return (
    <section
      className="mt-8 gap-3 grid"
      id="notifications"
      aria-labelledby="member-notifications-title"
    >
      <Kicker>Notification preferences</Kicker>
      <h2 id="member-notifications-title">How you get updates</h2>
      <p className="text-muted-foreground leading-[1.55]">
        To change these, open the GreenRoster app.
      </p>
      {preferences === null ? (
        <p className="text-muted-foreground leading-[1.55]" role="status">
          We could not load your notification settings. Open the app to review
          them.
        </p>
      ) : (
        preferences.map((preference) => (
          <section
            className="p-4 gap-6 border grid grid-cols-[minmax(0,1fr)_auto] bg-muted max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:font-bold [&_dl]:m-0 [&_dl]:gap-4 [&_dl]:flex [&_dl_div]:min-w-16 [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase [&_h2]:m-0 [&_h2]:text-[1.125rem] [&_h2]:font-semibold [&_p]:mx-0 [&_p]:mt-[0.35rem] [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:text-[0.8125rem]"
            key={preference.category}
          >
            <div>
              <h3>{formatCategory(preference.category)}</h3>
              <p>{preference.mandatory ? "Always on." : "Optional."}</p>
            </div>
            <dl>
              <div>
                <dt>E-mail</dt>
                <dd>
                  {preference.email_allowed
                    ? preference.email_enabled
                      ? "On"
                      : "Off"
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Push</dt>
                <dd>
                  {preference.push_allowed
                    ? preference.push_enabled
                      ? "On"
                      : "Off"
                    : "Unavailable"}
                </dd>
              </div>
            </dl>
          </section>
        ))
      )}
      <p className="text-muted-foreground leading-[1.55]">
        You always get cancellation and account security messages.
      </p>
    </section>
  );
}

function formatCategory(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
