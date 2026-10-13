// Kept out of the server-action file: that file may only export async
// functions.
export type InvitationActionState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
}>;

export const initialInvitationActionState: InvitationActionState = {
  status: "idle",
  message: "",
};
