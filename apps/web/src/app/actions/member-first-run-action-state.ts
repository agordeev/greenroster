// Kept out of the server-action file: that file may only export async
// functions.
export type MemberFirstRunActionState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
}>;

export const initialMemberFirstRunActionState: MemberFirstRunActionState = {
  status: "idle",
  message: "",
};
