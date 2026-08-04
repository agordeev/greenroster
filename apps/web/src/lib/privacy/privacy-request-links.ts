export type PrivacyRequestKind = "data_access" | "account_deletion";

const requestCopy: Record<
  PrivacyRequestKind,
  Readonly<{ subject: string; body: string }>
> = {
  data_access: {
    subject: "GreenRoster data access request",
    body: "Please provide a copy of the personal data associated with my GreenRoster account.\n\nAccount e-mail: ",
  },
  account_deletion: {
    subject: "GreenRoster account deletion request",
    body: "Please process deletion of my GreenRoster account. I understand that direct identifiers are removed or anonymized within 30 days unless a documented legal hold applies, while pseudonymized sporting history and audit records are retained.\n\nAccount e-mail: ",
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
