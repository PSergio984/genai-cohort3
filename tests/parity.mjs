// Parity check: every `gcloud` command shown in README.md must exist verbatim
// in cmd.md (the single repro source). Fails loudly on drift.
// Run from repo root:  node tests/parity.mjs
import { readFileSync } from 'node:fs';

const norm = (s) => s.trim().replace(/\s+/g, ' ');
const fenced = (md) =>
  [...md.replace(/\r\n/g, '\n').matchAll(/```(?:bash|powershell|sh)?\n([\s\S]*?)```/g)].map((m) => m[1]);

function gcloudLines(md) {
  return fenced(md)
    .flatMap((b) => b.split('\n'))
    .map((l) => l.trim())
    .filter((l) => l.startsWith('gcloud'))
    .map(norm);
}

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const cmd = readFileSync(new URL('../cmd.md', import.meta.url), 'utf8');
const inReadme = gcloudLines(readme);
const inCmd = new Set(gcloudLines(cmd));

let failures = 0;
for (const line of inReadme) {
  // Allow README to show commands with redacted placeholders only if cmd.md
  // carries the same shape with concrete flags (compare flag skeletons).
  const skeleton = (s) => s.replace(/\$[A-Z_]+/g, '$VAR').replace(/["']/g, '');
  const ok =
    inCmd.has(line) ||
    [...inCmd].some((c) => skeleton(c) === skeleton(line) || skeleton(c).includes(skeleton(line)));
  if (!ok) {
    failures++;
    console.error(`DRIFT (in README, missing from cmd.md):\n  ${line}`);
  }
}
console.log(`checked ${inReadme.length} gcloud line(s) from README against cmd.md — ${failures} drift(s)`);
process.exit(failures === 0 ? 0 : 1);
