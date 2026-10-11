// WCAG contrast of every pair in tokens.json (Node port of the replica-design checker).
// Usage: node replica/design/contrast.mjs replica/design/tokens.json   -> exit 1 on any AA failure
import { readFileSync } from "node:fs";
const tokens = JSON.parse(readFileSync(process.argv[2], "utf8"));
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
let failed = 0;
for (const [fg, bg, kind = "normal"] of tokens.pairs) {
  const need = kind === "normal" ? 4.5 : 3;
  const r = ratio(tokens.color[fg], tokens.color[bg]);
  const ok = r >= need;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (needs ${need})  ${fg} on ${bg}`);
}
console.log(failed ? `${failed} pair(s) fail WCAG AA` : "All pairs pass WCAG AA");
process.exitCode = failed ? 1 : 0;
