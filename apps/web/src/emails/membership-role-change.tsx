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

import { emailTheme } from "./theme";

export type MembershipRole = "member" | "coordinator" | "administrator";

export type MembershipRoleChangeEmailInput = Readonly<{
  actionUrl: string;
  groupName: string;
  oldRole: MembershipRole;
  newRole: MembershipRole;
}>;

export type MembershipRoleChangeEmail = Readonly<{
  html: string;
  subject: string;
  text: string;
}>;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function roleLabel(role: MembershipRole): string {
  return role[0].toUpperCase() + role.slice(1);
}

export function MembershipRoleChangeEmailDocument(
  input: MembershipRoleChangeEmailInput,
) {
  const groupName = singleLine(input.groupName);
  const oldRole = roleLabel(input.oldRole);
  const newRole = roleLabel(input.newRole);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your GreenRoster role changed in ${groupName} from ${oldRole} to ${newRole}.`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Your GreenRoster role changed</Heading>
          <Text style={textStyle}>
            Your role in {groupName} changed from <strong>{oldRole}</strong> to{" "}
            <strong>{newRole}</strong>.
          </Text>
          <Text style={mutedTextStyle}>
            Sign in to GreenRoster to see what your new role lets you do.
          </Text>
          <Button href={input.actionUrl} style={buttonStyle}>
            Open GreenRoster
          </Button>
          <Hr style={ruleStyle} />
          <Text style={mutedTextStyle}>
            If you did not expect this change, contact a group administrator.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function buildMembershipRoleChangeEmail(
  input: MembershipRoleChangeEmailInput,
): MembershipRoleChangeEmail {
  const groupName = singleLine(input.groupName);
  const oldRole = roleLabel(input.oldRole);
  const newRole = roleLabel(input.newRole);
  return {
    html: "",
    subject: `Your GreenRoster role changed in ${groupName}`,
    text: [
      `Your GreenRoster role changed in ${groupName}.`,
      "",
      `Your role changed from ${oldRole} to ${newRole}.`,
      "",
      "Sign in to GreenRoster to see what your new role lets you do.",
      "",
      `Open GreenRoster: ${input.actionUrl}`,
      "",
      "If you did not expect this change, contact a group administrator.",
    ].join("\n"),
  };
}

export async function renderMembershipRoleChangeEmail(
  input: MembershipRoleChangeEmailInput,
): Promise<MembershipRoleChangeEmail> {
  const content = buildMembershipRoleChangeEmail(input);
  return {
    ...content,
    html: await render(<MembershipRoleChangeEmailDocument {...input} />),
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
  color: emailTheme.primary,
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
  backgroundColor: emailTheme.primary,
  color: emailTheme.primaryForeground,
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "700",
  lineHeight: "1",
  padding: "14px 20px",
  textDecoration: "none",
};

const ruleStyle = {
  borderColor: emailTheme.border,
  margin: "24px 0",
};
