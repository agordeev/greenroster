import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
  render,
} from "react-email";

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
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            It stays on your invitations list, marked as needing action, until
            you fix it or resolve it.
          </Text>
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
      "",
      "It stays on your invitations list, marked as needing action, until you fix it or resolve it.",
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
  color: "#713333",
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

const buttonStyle = {
  backgroundColor: "#713333",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "700",
  lineHeight: "1",
  padding: "14px 20px",
  textDecoration: "none",
};

const ruleStyle = {
  borderColor: "#d9d1c0",
  margin: "24px 0",
};
