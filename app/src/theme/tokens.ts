// Colours are named by what they are for, not by how they look, so a screen asks for `surface`
// and gets white in light mode and a lighter navy in dark mode.
export const colors = {
  light: {
    background: "#F7F5EA",
    surface: "#FFFFFF",
    surfaceMuted: "#EBEBD0",
    text: "#0B1A2B",
    textMuted: "#4A5A6B",
    border: "#E4E1CF",
    // the quiet button: a fill, no outline
    secondary: "#E9E6D6",
    primary: "#00508E",
    onPrimary: "#FFFFFF",
    accent: "#FF6B35",
    onAccent: "#0B1A2B",
    soft: "#F8C3A0",
    onSoft: "#0B1A2B",
    danger: "#B3261E",
  },
  dark: {
    background: "#0F1A26",
    surface: "#17263A",
    surfaceMuted: "#2B3B50",
    text: "#F3F1E6",
    textMuted: "#A9B5C2",
    border: "#2B3B50",
    secondary: "#2B3B50",
    primary: "#00508E",
    onPrimary: "#FFFFFF",
    accent: "#FF6B35",
    onAccent: "#0B1A2B",
    soft: "#F8C3A0",
    onSoft: "#0B1A2B",
    danger: "#FF9B8F",
  },
} as const;

export type Scheme = keyof typeof colors;
export type ColorName = keyof (typeof colors)["light"];

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 10, lg: 16, xl: 20, pill: 999 } as const;

// React Native picks a custom font by its family name, one per weight (no `fontWeight`).
export const fontFamily = {
  // titles, times and counts: condensed and uppercase, with tabular numbers
  display: "BarlowCondensed_700Bold",
  displaySemibold: "BarlowCondensed_600SemiBold",
  regular: "Figtree_400Regular",
  semibold: "Figtree_600SemiBold",
  bold: "Figtree_700Bold",
  extrabold: "Figtree_800ExtraBold",
} as const;

export const type = {
  display: { fontFamily: fontFamily.display, fontSize: 56, lineHeight: 54, letterSpacing: 0, textTransform: "uppercase" },
  heading: { fontFamily: fontFamily.display, fontSize: 40, lineHeight: 40, letterSpacing: 0, textTransform: "uppercase" },
  // the title in the slim header at the top of every page but sign in and choose studio
  pageTitle: { fontFamily: fontFamily.display, fontSize: 32, lineHeight: 32, letterSpacing: 0.2, textTransform: "uppercase" },
  title: { fontFamily: fontFamily.bold, fontSize: 18, lineHeight: 24, letterSpacing: 0 },
  // the small capitals that name a section: "TODAY", "YOUR PLAN"
  eyebrow: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // a big number on a tile
  figure: { fontFamily: fontFamily.display, fontSize: 40, lineHeight: 40, letterSpacing: 0, fontVariant: ["tabular-nums"] },
  // a class's start time in a list row: "07:00"
  time: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 28, letterSpacing: 0, fontVariant: ["tabular-nums"] },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 22, letterSpacing: 0 },
  // a name in a list row ("Maya", "Cody Coach")
  rowName: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22, letterSpacing: 0 },
  label: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
} as const;

export type TypeName = keyof typeof type;
