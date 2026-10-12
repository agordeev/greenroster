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

export type ResultsPublishedEmailInput = Readonly<{
  completedAt: string;
  description: string;
  groupName: string;
  groupTimeZone: string;
  notificationPreferencesUrl: string;
  resultsUrl: string;
}>;

export type ResultsPublishedEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function completedLabel(completedAt: string, groupTimeZone: string): string {
  const date = new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return singleLine(completedAt);
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

export function ResultsPublishedEmailDocument(
  input: ResultsPublishedEmailInput,
) {
  const completedAt = completedLabel(input.completedAt, input.groupTimeZone);
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Results are ready from ${description}.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Results are ready</Heading>
          <Text style={textStyle}>
            Official results for <strong>{description}</strong> in {groupName}
            are now available.
          </Text>
          <Text style={textStyle}>
            <strong>Completed:</strong> {completedAt}
          </Text>
          <Link href={input.resultsUrl} style={linkStyle}>
            View the round results
          </Link>
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            Sign in to GreenRoster to review the results, standings, and your
            score history. You can manage optional e-mail notifications from
            your{" "}
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

export function buildResultsPublishedEmail(
  input: ResultsPublishedEmailInput,
): ResultsPublishedEmail {
  const completedAt = completedLabel(input.completedAt, input.groupTimeZone);
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  return {
    html: "",
    subject: `Results are ready from ${description}`,
    text: [
      `Results are ready from ${description}.`,
      "",
      `Official results for ${description} in ${groupName} are now available.`,
      `Completed: ${completedAt}`,
      "",
      `View the round results: ${input.resultsUrl}`,
      "",
      `Sign in to GreenRoster to review the results, standings, and your score history. Manage optional e-mail notifications: ${input.notificationPreferencesUrl}`,
    ].join("\n"),
  };
}

export async function renderResultsPublishedEmail(
  input: ResultsPublishedEmailInput,
): Promise<ResultsPublishedEmail> {
  const content = buildResultsPublishedEmail(input);
  return {
    ...content,
    html: await render(<ResultsPublishedEmailDocument {...input} />),
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
