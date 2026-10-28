import { colors, type ColorName, type Scheme } from "./tokens";

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every pairing the screens use: [text colour, the colour it sits on].
const PAIRS: [ColorName, ColorName][] = [
  ["text", "background"],
  ["text", "surface"],
  ["text", "surfaceMuted"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["onPrimary", "primary"],
  ["soft", "primary"],
  ["onAccent", "accent"],
  ["onSoft", "soft"],
  ["danger", "background"],
  ["danger", "surface"],
];

describe.each(Object.keys(colors) as Scheme[])("%s colours", (scheme) => {
  test.each(PAIRS)("%s on %s is readable (4.5:1)", (fg, bg) => {
    expect(contrast(colors[scheme][fg], colors[scheme][bg])).toBeGreaterThanOrEqual(4.5);
  });
});

test("both schemes define the same colour names", () => {
  expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
});
