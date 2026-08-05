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

export type RoundPublishedEmailInput = Readonly<{
  description: string;
  format: "individual_net" | "individual_gross";
  groupName: string;
  groupTimeZone: string;
  notificationPreferencesUrl: string;
  scheduledAt: string;
}>;

export type RoundPublishedEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatLabel(format: RoundPublishedEmailInput["format"]): string {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function scheduledLabel(scheduledAt: string, groupTimeZone: string): string {
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) return singleLine(scheduledAt);
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

export function RoundPublishedEmailDocument(input: RoundPublishedEmailInput) {
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const format = formatLabel(input.format);
  const scheduledAt = scheduledLabel(input.scheduledAt, input.groupTimeZone);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`A new round is ready in ${groupName}.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>A new round is ready</Heading>
          <Text style={textStyle}>
            {description} has been published in {groupName}.
          </Text>
          <Text style={textStyle}>
            <strong>Format:</strong> {format}
            <br />
            <strong>Scheduled for:</strong> {scheduledAt}
          </Text>
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            Sign in to GreenRoster to view the round and respond. You can manage
            optional e-mail notifications from your{" "}
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

export function buildRoundPublishedEmail(
  input: RoundPublishedEmailInput,
): RoundPublishedEmail {
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const format = formatLabel(input.format);
  const scheduledAt = scheduledLabel(input.scheduledAt, input.groupTimeZone);
  return {
    html: "",
    subject: `A new round is ready in ${groupName}`,
    text: [
      `A new round is ready in ${groupName}.`,
      "",
      description,
      "",
      `Format: ${format}`,
      `Scheduled for: ${scheduledAt}`,
      "",
      `Sign in to GreenRoster to view the round and respond. Manage optional e-mail notifications: ${input.notificationPreferencesUrl}`,
    ].join("\n"),
  };
}

export async function renderRoundPublishedEmail(
  input: RoundPublishedEmailInput,
): Promise<RoundPublishedEmail> {
  const content = buildRoundPublishedEmail(input);
  return {
    ...content,
    html: await render(<RoundPublishedEmailDocument {...input} />),
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
