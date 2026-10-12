// The web theme as hex values. E-mail clients do not reliably support CSS
// variables or oklch(), so the palette from globals.css is repeated here.
export const emailTheme = {
  background: "#f5f5f5",
  card: "#ffffff",
  border: "#e5e5e5",
  foreground: "#0a0a0a",
  mutedForeground: "#636363",
  primary: "#171717",
  primaryForeground: "#fafafa",
  destructive: "#e7000b",
} as const;
