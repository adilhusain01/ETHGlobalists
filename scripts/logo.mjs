// Draws the ETHGlobalists mark as SVG: an ink tile, a cream diamond and a gold laurel.
// `node scripts/logo.mjs` writes assets/logo.svg (full) and assets/logo-small.svg (16/32 px).
import { writeFileSync, mkdirSync } from "node:fs";

const INK = "#1C1A14";
const PAPER = "#ECE5D3";
const TRAY = "#CFC4A8";
const LAMP = "#C9A15A";
const GOLD = "#A87E36";

const f = (n) => Number(n.toFixed(2));

function diamond(cx, cy, s) {
  // Ethereum-style octahedron, s = half height
  const w = s * 0.62;
  const midY = cy - s * 0.02;
  const top = [
    `M${f(cx)} ${f(cy - s)} L${f(cx - w)} ${f(midY)} L${f(cx)} ${f(midY + s * 0.3)} Z`,
    `M${f(cx)} ${f(cy - s)} L${f(cx + w)} ${f(midY)} L${f(cx)} ${f(midY + s * 0.3)} Z`,
  ];
  const lowY = midY + s * 0.14;
  const bottom = [
    `M${f(cx - w)} ${f(lowY)} L${f(cx)} ${f(cy + s)} L${f(cx)} ${f(lowY + s * 0.3)} Z`,
    `M${f(cx + w)} ${f(lowY)} L${f(cx)} ${f(cy + s)} L${f(cx)} ${f(lowY + s * 0.3)} Z`,
  ];
  return [
    `<path d="${top[0]}" fill="${PAPER}"/>`,
    `<path d="${top[1]}" fill="${TRAY}"/>`,
    `<path d="${bottom[0]}" fill="${PAPER}"/>`,
    `<path d="${bottom[1]}" fill="${TRAY}"/>`,
  ].join("");
}

function leaf(x, y, angle, len, width) {
  // A pointed leaf along `angle` (radians), base at x,y
  const tipX = x + Math.cos(angle) * len;
  const tipY = y + Math.sin(angle) * len;
  const nx = -Math.sin(angle) * width;
  const ny = Math.cos(angle) * width;
  const mx = (x + tipX) / 2;
  const my = (y + tipY) / 2;
  return `M${f(x)} ${f(y)} Q${f(mx + nx)} ${f(my + ny)} ${f(tipX)} ${f(tipY)} Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)} Z`;
}

function branch(cx, cy, r, side) {
  // side = -1 left, 1 right. theta = 0 at the bottom of the circle, growing up the side.
  const from = 0.32;
  const to = 2.55;
  const count = 7;
  const point = (t) => [cx + side * r * Math.sin(t), cy + r * Math.cos(t)];
  const stem = [];
  for (let i = 0; i <= 40; i++) {
    const [x, y] = point(from + ((to - from) * i) / 40);
    stem.push(`${i ? "L" : "M"}${f(x)} ${f(y)}`);
  }
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * (i + 0.7)) / (count + 0.4);
    const [x, y] = point(t);
    const tangent = Math.atan2(-Math.sin(t), side * Math.cos(t)); // direction up the branch
    const size = 14 - i * 0.85;
    leaves.push(leaf(x, y, tangent + side * 0.62, size, size * 0.36)); // outer leaf
    leaves.push(leaf(x, y, tangent - side * 0.5, size * 0.78, size * 0.32)); // inner leaf
  }
  const [tx, ty] = point(to);
  const tipAngle = Math.atan2(-Math.sin(to), side * Math.cos(to));
  leaves.push(leaf(tx, ty, tipAngle, 9, 3.2));
  return { leaves: leaves.join(" "), stem: stem.join(" ") };
}

function full() {
  const cx = 64;
  const cy = 66;
  const left = branch(cx, cy, 41, -1);
  const right = branch(cx, cy, 41, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
<rect x="4" y="4" width="120" height="120" rx="28" fill="${INK}"/>
<path d="${left.stem}" fill="none" stroke="${LAMP}" stroke-width="2.4" stroke-linecap="round"/>
<path d="${right.stem}" fill="none" stroke="${LAMP}" stroke-width="2.4" stroke-linecap="round"/>
<path d="${left.leaves}" fill="${LAMP}"/>
<path d="${right.leaves}" fill="${LAMP}"/>
${diamond(cx, cy - 2, 27)}
</svg>
`;
}

function small() {
  // Fewer details so it still reads at 16 px: tile, diamond, two gold arcs.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
<rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="${INK}"/>
<path d="M9.2 25.2 A11 11 0 0 1 9.6 6.4" fill="none" stroke="${LAMP}" stroke-width="2.6" stroke-linecap="round"/>
<path d="M22.8 25.2 A11 11 0 0 0 22.4 6.4" fill="none" stroke="${LAMP}" stroke-width="2.6" stroke-linecap="round"/>
${diamond(16, 16, 9.5)}
</svg>
`;
}

mkdirSync("assets", { recursive: true });
writeFileSync("assets/logo.svg", full());
writeFileSync("assets/logo-small.svg", small());
void GOLD;
console.log("wrote assets/logo.svg and assets/logo-small.svg");
