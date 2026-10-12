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

export type MembershipInvitationEmailInput = Readonly<{
  acceptanceUrl: string;
  expiresAt: string;
  firstName: string;
  groupName: string;
}>;

export type MembershipInvitationEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function invitationExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return singleLine(expiresAt);
  return date.toISOString();
}

export function MembershipInvitationEmailDocument(
  input: MembershipInvitationEmailInput,
) {
  const firstName = singleLine(input.firstName);
  const groupName = singleLine(input.groupName);
  const expiresAt = invitationExpiry(input.expiresAt);

  return (
    <Html lang="en">
      <Head />
      <Preview>You are invited to join {groupName} on GreenRoster.</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>
            You are invited to join {groupName}
          </Heading>
          <Text style={textStyle}>Hi {firstName},</Text>
          <Text style={textStyle}>
            You have been invited to join {groupName} as a member on
            GreenRoster.
          </Text>
          <Button href={input.acceptanceUrl} style={buttonStyle}>
            Accept your invitation
          </Button>
          <Text style={mutedTextStyle}>
            This invitation expires on <strong>{expiresAt}</strong>.
          </Text>
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            If you did not expect this invitation, you can safely ignore this
            e-mail.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function buildMembershipInvitationEmail(
  input: MembershipInvitationEmailInput,
): MembershipInvitationEmail {
  const firstName = singleLine(input.firstName);
  const groupName = singleLine(input.groupName);
  const expiresAt = invitationExpiry(input.expiresAt);

  const text = [
    `You are invited to join ${groupName} on GreenRoster.`,
    "",
    `Hi ${firstName},`,
    "",
    `You have been invited to join ${groupName} as a member on GreenRoster.`,
    "",
    `Accept your invitation: ${input.acceptanceUrl}`,
    "",
    `This invitation expires on ${expiresAt}.`,
    "",
    "If you did not expect this invitation, you can safely ignore this e-mail.",
  ].join("\n");

  return {
    html: "",
    subject: `You are invited to join ${groupName}`,
    text,
  };
}

export async function renderMembershipInvitationEmail(
  input: MembershipInvitationEmailInput,
): Promise<MembershipInvitationEmail> {
  const content = buildMembershipInvitationEmail(input);
  return {
    ...content,
    html: await render(<MembershipInvitationEmailDocument {...input} />),
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

const buttonStyle = {
  backgroundColor: "#213d2b",
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
