// dev-office adr new <title> | refute <file> | list
// One-page MADR records. Superseded records are marked, never edited.
// `refute` runs the Codex CLI directly in refute mode and appends its output.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { repoRoot } from './lib/git.mjs';
import { isMain } from './lib/main.mjs';

export function adrDir(config, root) {
  if (config.adr.dir) return path.resolve(root, config.adr.dir);
  const sibling = path.join(path.dirname(root), 'dev-docs');
  if (path.basename(root) === 'main' && repoRoot(sibling) === sibling) return path.join(sibling, 'adr');
  return path.join(root, 'docs', 'adr');
}

export function nextNumber(dir) {
  let max = 0;
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return '0001'; throw e; }
  // Four-OR-MORE digits: once 0001..9999 is exhausted, filenames grow to five
  // digits ("10000-foo.md"). A fixed `{4}` would stop matching those files at
  // exactly the point they start existing, and every later call would see
  // only the pre-10000 max and keep reissuing "10000".
  for (const f of entries) { const m = /^(\d{4,})-/.exec(f); if (m) max = Math.max(max, Number(m[1])); }
  return String(max + 1).padStart(4, '0');
}

// `nextNumber` reads the directory, then `new` writes a few lines later; two
// concurrent `adr new` calls can both read the same max and race to create the
// same filename. `wx` makes the loser's write fail instead of clobbering the
// winner's file; this retries with a freshly recomputed number instead of
// surfacing that as a crash. A bounded number of attempts, since a real
// collision resolves on the very next read.
export function createRecord(dir, title, date, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const file = path.join(dir, `${nextNumber(dir)}-${slugify(title)}.md`);
    try { fs.writeFileSync(file, template(title, date), { flag: 'wx' }); return file; }
    catch (e) { if (e.code !== 'EEXIST' || i === attempts - 1) throw e; }
  }
  throw new Error('unreachable');
}

export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function template(title, date) {
  return `# ${title}

- Status: proposed
- Date: ${date}

## Context and problem statement

## Decision

## Consequences

## Refutation

Not yet run. \`dev-office adr refute <this file>\` sends the record to Codex in refute mode.
`;
}

export const REFUTE_PROMPT = `You are reviewing an architecture decision record in refute mode. Do not agree, summarize or praise. Attack the decision: name specific failure modes, each with the concrete check that would expose it (a command to run, a file to read, a test to write, a number to measure). An objection without a check is worthless; omit it. End with: the single strongest objection, and what evidence would make you withdraw it. Keep it under 400 words. The record follows.\n\n`;

if (isMain(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2);
  const { config, repo } = loadConfig();
  if (!repo) { console.error('dev-office adr: not inside a git repository'); process.exit(2); }
  const dir = adrDir(config, repo);
  if (sub === 'new') {
    const title = rest.join(' ').trim();
    if (!title) { console.error('usage: dev-office adr new <title>'); process.exit(2); }
    fs.mkdirSync(dir, { recursive: true });
    const file = createRecord(dir, title, new Date().toISOString().slice(0, 10));
    console.log(file);
  } else if (sub === 'list') {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!files.length) console.log(`no records in ${dir}`);
    for (const f of files) { const status = (/^- Status: (.*)$/m.exec(fs.readFileSync(path.join(dir, f), 'utf8')) || [])[1] || '?'; console.log(`${f}  [${status}]`); }
  } else if (sub === 'refute') {
    const file = rest[0];
    if (!file || !fs.existsSync(file)) { console.error('usage: dev-office adr refute <file>'); process.exit(2); }
    const which = spawnSync('sh', ['-c', 'command -v codex'], { encoding: 'utf8' });
    if (which.status !== 0) { console.error('dev-office adr refute: codex CLI not found on PATH; no second opinion was taken'); process.exit(3); }
    const body = fs.readFileSync(file, 'utf8');
    // stdin is ignored on purpose: a headless `codex exec` with an open non-tty stdin waits for more input forever.
    const r = spawnSync('codex', ['exec', '--sandbox', 'read-only', REFUTE_PROMPT + body], { encoding: 'utf8', cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) { console.error(`dev-office adr refute: codex exec failed (exit ${r.status})\n${r.stderr}`); process.exit(1); }
    const out = r.stdout.trim();
    const stamp = `\n### Codex refutation, ${new Date().toISOString().slice(0, 10)}\n\n${out}\n`;
    fs.appendFileSync(file, stamp);
    process.stdout.write(out + '\n');
    console.log(`\nAppended to ${file}. Discard objections that carry no check; one objection whose check fails blocks the decision.`);
  } else {
    console.error('usage: dev-office adr new <title> | refute <file> | list'); process.exit(2);
  }
}
