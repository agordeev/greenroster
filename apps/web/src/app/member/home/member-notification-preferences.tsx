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
      className="member-preferences-list"
      id="notifications"
      aria-labelledby="member-notifications-title"
    >
      <p className="ledger-kicker">Notification preferences</p>
      <h2 id="member-notifications-title">Choose where updates arrive</h2>
      <p className="member-results-intro">
        These current values are read-only on the member web view. Open the
        signed-in GreenRoster app to change them.
      </p>
      {preferences === null ? (
        <p className="member-read-empty" role="status">
          Notification preferences are temporarily unavailable. Open the app to
          review them.
        </p>
      ) : (
        preferences.map((preference) => (
          <section className="member-preference-row" key={preference.category}>
            <div>
              <h3>{formatCategory(preference.category)}</h3>
              <p>
                {preference.mandatory
                  ? "Required for account or round safety."
                  : "Optional notification category."}
              </p>
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
      <p className="member-read-note">
        Mandatory cancellation and security messages cannot be disabled.
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
