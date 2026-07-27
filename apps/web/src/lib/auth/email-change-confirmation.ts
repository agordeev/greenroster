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
        "This confirmation link could not be accepted. Request a new account e-mail change and use the latest messages.",
    };
  }

  return {
    status: "submitted",
    message:
      "This confirmation step was submitted to the account provider. Complete any other required message, then refresh your account status.",
  };
}
