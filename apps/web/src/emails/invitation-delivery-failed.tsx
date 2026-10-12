import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
  render,
} from "react-email";

import { emailTheme } from "./theme";

export type InvitationDeliveryFailedEmailInput = Readonly<{
  actionUrl: string;
  groupName: string;
  invitedAddress: string;
}>;

export type InvitationDeliveryFailedEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function InvitationDeliveryFailedEmailDocument(
  input: InvitationDeliveryFailedEmailInput,
) {
  const groupName = singleLine(input.groupName);
  const invitedAddress = singleLine(input.invitedAddress);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`We couldn't deliver the invitation to ${invitedAddress}.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>
            We couldn&apos;t deliver an invitation
          </Heading>
          <Text style={textStyle}>
            We couldn&apos;t deliver the invitation for {groupName} to{" "}
            <strong>{invitedAddress}</strong>.
          </Text>
          <Text style={mutedTextStyle}>
            Check the e-mail address, fix it, and send a new link from the
            invitations page.
          </Text>
          <Button href={input.actionUrl} style={buttonStyle}>
            Open invitations
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

export function buildInvitationDeliveryFailedEmail(
  input: InvitationDeliveryFailedEmailInput,
): InvitationDeliveryFailedEmail {
  const groupName = singleLine(input.groupName);
  const invitedAddress = singleLine(input.invitedAddress);
  return {
    html: "",
    subject: `We couldn't deliver an invitation in ${groupName}`,
    text: [
      "We couldn't deliver an invitation.",
      "",
      `We couldn't deliver the invitation for ${groupName} to ${invitedAddress}.`,
      "",
      "Check the e-mail address, fix it, and send a new link from the invitations page.",
      "",
      `Open invitations: ${input.actionUrl}`,
    ].join("\n"),
  };
}

export async function renderInvitationDeliveryFailedEmail(
  input: InvitationDeliveryFailedEmailInput,
): Promise<InvitationDeliveryFailedEmail> {
  const content = buildInvitationDeliveryFailedEmail(input);
  return {
    ...content,
    html: await render(<InvitationDeliveryFailedEmailDocument {...input} />),
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

const mutedTextStyle = {
  color: emailTheme.mutedForeground,
  fontSize: "14px",
  lineHeight: "1.5",
};

const buttonStyle = {
  backgroundColor: emailTheme.destructive,
  color: emailTheme.primaryForeground,
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "700",
  lineHeight: "1",
  padding: "14px 20px",
  textDecoration: "none",
};
