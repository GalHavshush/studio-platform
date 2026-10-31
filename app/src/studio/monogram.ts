// The studio's initials for its placeholder logo: "Pilot Studio" is "PS", a single word gives its
// first two letters. A name with no letters or digits gives "?".
export function monogram(name: string): string {
  const [first = "", second] = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (first === "") return "?";
  const head = (w: string, n: number) => [...w].slice(0, n).join("");
  return (second === undefined ? head(first, 2) : head(first, 1) + head(second, 1)).toUpperCase();
}
