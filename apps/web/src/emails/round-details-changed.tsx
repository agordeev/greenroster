import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
  render,
} from "react-email";

export type RoundDetailsChangedEmailInput = Readonly<{
  description: string;
  groupName: string;
  groupTimeZone: string;
  notificationPreferencesUrl: string;
  scheduledAt: string;
  venue: string | null;
  rsvpDeadlineAt: string | null;
}>;

export type RoundDetailsChangedEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function optionalLabel(value: string | null): string {
  if (value === null) return "Not provided";
  const normalized = singleLine(value);
  return normalized || "Not provided";
}

function dateLabel(value: string | null, groupTimeZone: string): string {
  if (value === null) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return singleLine(value);
  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: groupTimeZone,
      timeZoneName: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function RoundDetailsChangedEmailDocument(
  input: RoundDetailsChangedEmailInput,
) {
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const scheduledAt = dateLabel(input.scheduledAt, input.groupTimeZone);
  const venue = optionalLabel(input.venue);
  const rsvpDeadlineAt = dateLabel(input.rsvpDeadlineAt, input.groupTimeZone);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`The details for ${description} in ${groupName} changed.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Round details changed</Heading>
          <Text style={textStyle}>
            The details for <strong>{description}</strong> in {groupName} were
            updated.
          </Text>
          <Text style={textStyle}>
            <strong>Scheduled for:</strong> {scheduledAt}
            <br />
            <strong>Venue:</strong> {venue}
            <br />
            <strong>RSVP deadline:</strong> {rsvpDeadlineAt}
          </Text>
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            Sign in to GreenRoster to review the round and update your RSVP if
            needed. You can manage optional e-mail notifications from your{" "}
            <Link href={input.notificationPreferencesUrl} style={linkStyle}>
              notification preferences
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function buildRoundDetailsChangedEmail(
  input: RoundDetailsChangedEmailInput,
): RoundDetailsChangedEmail {
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const scheduledAt = dateLabel(input.scheduledAt, input.groupTimeZone);
  const venue = optionalLabel(input.venue);
  const rsvpDeadlineAt = dateLabel(input.rsvpDeadlineAt, input.groupTimeZone);
  return {
    html: "",
    subject: `Round details changed in ${groupName}`,
    text: [
      `Round details changed in ${groupName}.`,
      "",
      description,
      "",
      `Scheduled for: ${scheduledAt}`,
      `Venue: ${venue}`,
      `RSVP deadline: ${rsvpDeadlineAt}`,
      "",
      `Sign in to GreenRoster to review the round and update your RSVP if needed. Manage optional e-mail notifications: ${input.notificationPreferencesUrl}`,
    ].join("\n"),
  };
}

export async function renderRoundDetailsChangedEmail(
  input: RoundDetailsChangedEmailInput,
): Promise<RoundDetailsChangedEmail> {
  const content = buildRoundDetailsChangedEmail(input);
  return {
    ...content,
    html: await render(<RoundDetailsChangedEmailDocument {...input} />),
  };
}

const bodyStyle = {
  backgroundColor: "#f7f3ea",
  color: "#22231f",
  fontFamily: "Arial, sans-serif",
  margin: "0",
  padding: "32px 0",
};

const containerStyle = {
  backgroundColor: "#fffdf8",
  border: "1px solid #d9d1c0",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const headingStyle = {
  color: "#213d2b",
  fontSize: "26px",
  fontWeight: "700",
  lineHeight: "1.25",
};

const textStyle = {
  color: "#22231f",
  fontSize: "16px",
  lineHeight: "1.6",
};

const mutedTextStyle = {
  color: "#595a52",
  fontSize: "14px",
  lineHeight: "1.5",
};

const linkStyle = {
  color: "#213d2b",
  fontWeight: "700",
};

const ruleStyle = {
  borderColor: "#d9d1c0",
  margin: "24px 0",
};
