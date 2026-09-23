import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const tokens = new Map();
for (const match of source.matchAll(/--(color-[\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)/g)) {
  tokens.set(match[1], [Number(match[2]) / 100, Number(match[3]), Number(match[4])]);
}

function luminance([L, C, degrees]) {
  const radians = degrees * Math.PI / 180;
  const a = C * Math.cos(radians);
  const b = C * Math.sin(radians);
  const l0 = L + 0.3963377774 * a + 0.2158037573 * b;
  const m0 = L - 0.1055613458 * a - 0.0638541728 * b;
  const s0 = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l0 ** 3;
  const m = m0 ** 3;
  const s = s0 ** 3;
  const r = Math.min(1, Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s));
  const g = Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s));
  const blue = Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
  return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
}

function contrast(foreground, background) {
  const one = luminance(tokens.get(foreground));
  const two = luminance(tokens.get(background));
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

const pairs = [
  ['color-ink', 'color-paper', 4.5],
  ['color-ink-2', 'color-paper', 4.5],
  ['color-muted', 'color-paper', 4.5],
  ['color-ink', 'color-surface', 4.5],
  ['color-muted', 'color-surface', 4.5],
  ['color-muted', 'color-paper-2', 4.5],
  ['color-accent', 'color-paper', 4.5],
  ['color-accent', 'color-paper-3', 4.5],
  ['color-accent-ink', 'color-accent', 4.5],
  ['color-graphite-ink', 'color-graphite', 4.5],
  ['color-paper-3', 'color-graphite', 4.5],
  ['color-rule-strong', 'color-graphite', 4.5],
  ['color-success', 'color-success-soft', 4.5],
  ['color-warning', 'color-warning-soft', 4.5],
  ['color-danger', 'color-danger-soft', 4.5],
  ['color-focus', 'color-paper', 3],
  ['color-focus', 'color-surface', 3],
];

let failed = false;
for (const [foreground, background, threshold] of pairs) {
  const ratio = contrast(foreground, background);
  const pass = ratio >= threshold;
  if (!pass) failed = true;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${foreground} on ${background}: ${ratio.toFixed(2)}:1 (minimum ${threshold}:1)`);
}
if (failed) process.exitCode = 1;
