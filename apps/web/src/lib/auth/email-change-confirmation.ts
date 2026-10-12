export type EmailChangeConfirmationResult = Readonly<{
  status: "submitted" | "error";
  message: string;
}>;

export function shouldScrubEmailChangeConfirmation(
  search: string,
  hash: string,
): boolean {
  return search.length > 0 || hash.length > 0;
}

export function resolveEmailChangeConfirmation(
  search: string,
  hash: string,
): EmailChangeConfirmationResult {
  const searchParameters = new URLSearchParams(search);
  const hashParameters = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const error = hashParameters.get("error") ?? searchParameters.get("error");
  const errorCode =
    hashParameters.get("error_code") ?? searchParameters.get("error_code");

  if (error || errorCode) {
    return {
      status: "error",
      message:
        "This link didn't work. Request a new e-mail change, then use the newest confirmation message.",
    };
  }

  return {
    status: "submitted",
    message:
      "Your confirmation was received. Follow the link in any other message we sent, then reload your account page.",
  };
}
