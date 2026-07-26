export type AuthFormState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export const initialAuthFormState: AuthFormState = {
  status: "idle",
  message: "",
};
