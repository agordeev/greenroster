export type PrivacyRequestKind = "data_access" | "account_deletion";

const requestCopy: Record<
  PrivacyRequestKind,
  Readonly<{ subject: string; body: string }>
> = {
  data_access: {
    subject: "GreenRoster data access request",
    body: "Please send me a copy of the personal data linked to my GreenRoster account.\n\nAccount e-mail: ",
  },
  account_deletion: {
    subject: "GreenRoster account deletion request",
    body: "Please delete my GreenRoster account. I understand that my account and contact details are removed or anonymized within 30 days unless a legal hold applies, and that scores, results, and change history are kept in a form that doesn't identify me directly.\n\nAccount e-mail: ",
  },
};

export function buildPrivacyRequestMailto(
  privacyOwnerEmail: string,
  accountEmail: string,
  kind: PrivacyRequestKind,
): string {
  const copy = requestCopy[kind];
  const body = `${copy.body}${accountEmail}`;
  return `mailto:${privacyOwnerEmail}?subject=${encodeURIComponent(copy.subject)}&body=${encodeURIComponent(body)}`;
}
