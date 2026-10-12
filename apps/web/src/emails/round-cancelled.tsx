import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
  render,
} from "react-email";

import { emailTheme } from "./theme";

export type RoundCancelledEmailInput = Readonly<{
  cancellationReason: string;
  description: string;
  groupName: string;
  groupTimeZone: string;
  scheduledAt: string;
}>;

export type RoundCancelledEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
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

export function RoundCancelledEmailDocument(input: RoundCancelledEmailInput) {
  const cancellationReason = singleLine(input.cancellationReason);
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const scheduledAt = scheduledLabel(input.scheduledAt, input.groupTimeZone);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`The round in ${groupName} has been cancelled.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Round cancelled</Heading>
          <Text style={textStyle}>
            <strong>{description}</strong> in {groupName} has been cancelled.
          </Text>
          <Text style={textStyle}>
            <strong>Scheduled for:</strong> {scheduledAt}
            <br />
            <strong>Reason:</strong> {cancellationReason}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function buildRoundCancelledEmail(
  input: RoundCancelledEmailInput,
): RoundCancelledEmail {
  const cancellationReason = singleLine(input.cancellationReason);
  const description = singleLine(input.description);
  const groupName = singleLine(input.groupName);
  const scheduledAt = scheduledLabel(input.scheduledAt, input.groupTimeZone);
  return {
    html: "",
    subject: `Round cancelled in ${groupName}`,
    text: [
      `The round in ${groupName} has been cancelled.`,
      "",
      description,
      `Scheduled for: ${scheduledAt}`,
      `Reason: ${cancellationReason}`,
    ].join("\n"),
  };
}

export async function renderRoundCancelledEmail(
  input: RoundCancelledEmailInput,
): Promise<RoundCancelledEmail> {
  const content = buildRoundCancelledEmail(input);
  return {
    ...content,
    html: await render(<RoundCancelledEmailDocument {...input} />),
  };
}

const bodyStyle = {
  backgroundColor: emailTheme.background,
  color: emailTheme.foreground,
  fontFamily: "Arial, sans-serif",
  margin: "0",
  padding: "32px 0",
};

const containerStyle = {
  backgroundColor: emailTheme.card,
  border: `1px solid ${emailTheme.border}`,
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const headingStyle = {
  color: emailTheme.destructive,
  fontSize: "26px",
  fontWeight: "700",
  lineHeight: "1.25",
};

const textStyle = {
  color: emailTheme.foreground,
  fontSize: "16px",
  lineHeight: "1.6",
};
