#!/usr/bin/env node
/**
 * scripts/check-contrast.mjs — design-token checks for style.css (no dependencies).
 *
 *   node scripts/check-contrast.mjs        (or: npm run check:contrast)
 *
 * 1. WCAG contrast: every text token on every background token, in the light
 *    (:root) and dark ([data-theme="dark"]) themes, must reach 4.5:1.
 * 2. No colour literal (#hex, rgb(), hsl()) outside the token blocks in style.css
 *    css/blog.css and css/write.css. The highlight.js theme in css/blog.css is the one exception.
 * Exits with code 1 if anything fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

const TEXT = ['text', 'text-secondary', 'text-muted', 'primary', 'primary-dark', 'navy', 'accent'];
const BACKGROUNDS = ['bg', 'bg-secondary', 'bg-tertiary', 'bg-card', 'header-bg', 'primary-soft', 'navy-soft', 'accent-soft'];
const EXTRA = [
  ['on-primary', 'primary'],        // primary buttons, active filters
  ['on-primary', 'primary-dark'],   // primary button hover
  ['danger', 'danger-soft'],        // video error message
];
const MIN = 4.5;

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No "${selector} {" block in style.css`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function parseColor(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`Cannot parse colour "${v}"`);
}

const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (rgb) => {
  const [r, g, b] = rgb.slice(0, 3).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failures = 0;
const light = block(':root');
const themes = { light, dark: { ...light, ...block('[data-theme="dark"]') } };

for (const [name, vars] of Object.entries(themes)) {
  const page = parseColor(vars.bg);
  const resolve = (t) => {
    let v = vars[t];
    while (/^var\(--([\w-]+)\)$/.test(v)) v = vars[/^var\(--([\w-]+)\)$/.exec(v)[1]];
    return over(parseColor(v), page); // translucent tokens are composited over the page
  };
  const pairs = [...TEXT.flatMap((t) => BACKGROUNDS.map((b) => [t, b])), ...EXTRA];
  let worst = { r: Infinity };
  for (const [t, b] of pairs) {
    const r = ratio(resolve(t), resolve(b));
    if (r < worst.r) worst = { r, t, b };
    if (r < MIN) { failures++; console.log(`✖ ${name}: --${t} on --${b} = ${r.toFixed(2)}:1`); }
  }
  console.log(`${name}: ${pairs.length} pairs checked, lowest ${worst.r.toFixed(2)}:1 (--${worst.t} on --${worst.b})`);
}

// colour literals outside the token blocks
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
function stripTokenBlocks(text) {
  return text
    .replace(/:root\s*\{[\s\S]*?\n\s*\}/g, '')
    .replace(/:root,\s*\[data-theme="dark"\]\s*\{[\s\S]*?\n\s*\}/g, '')
    .replace(/\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/g, '');
}
for (const file of ['style.css', 'css/blog.css', 'css/write.css']) {
  const lines = stripTokenBlocks(fs.readFileSync(path.join(ROOT, file), 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (/\.hljs/.test(line)) return; // code highlighting theme
    if (LITERAL.test(line.replace(/\/\*.*?\*\//g, ''))) { failures++; console.log(`✖ ${file}: colour literal outside the tokens: ${line.trim()}`); }
  });
}

if (failures) { console.log(`\n${failures} problem(s).`); process.exit(1); }
console.log('✔ contrast and colour-literal checks passed');
