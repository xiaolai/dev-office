// dev-office repo-init [workspace] [--check] [--maintenance]
// Creates or verifies the main/ + dev-docs/ + worktrees/ layout. Never
// overwrites an existing file, never commits, never moves a .git directory.
// --check runs the gate only. --maintenance opts into `git maintenance start`,
// which edits global git config and installs a scheduler entry.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, repoRoot } from './lib/git.mjs';
import { isMain } from './lib/main.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = path.join(here, 'repo-init', 'templates');
const GATE = path.join(here, 'repo-init', 'gate.sh');

function copyIfMissing(src, dest, mode) {
  // COPYFILE_EXCL fails with EEXIST if `dest` already exists as anything —
  // file, directory, or a dangling symlink `existsSync` would have reported
  // as absent — instead of the previous existsSync-then-copy, which leaves a
  // window for another process to create `dest` in between, and which
  // `existsSync` would not even have detected for a broken symlink.
  try {
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code === 'EEXIST') return `kept     ${dest}`;
    throw e;
  }
  if (mode) fs.chmodSync(dest, mode);
  return `created  ${dest}`;
}

function ensureRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (repoRoot(dir) === fs.realpathSync(dir)) {
    // `git rev-parse --show-toplevel` reports the same answer for an
    // independent repository and for a linked worktree of one: both are
    // their own toplevel. Only `.git` being a real directory tells them
    // apart, and every step after this one (ensureExclude, in particular)
    // assumes that — calling a worktree "kept" here let it reach
    // `fs.mkdirSync('.git/info', ...)` against a `.git` that is a plain file
    // and crash uncaught instead of being reported.
    if (!fs.statSync(path.join(dir, '.git')).isDirectory()) return `WARNING  ${dir} is a linked worktree, not an independent repository; not managed here`;
    return `kept     ${dir} (repository)`;
  }
  if (repoRoot(dir)) return `WARNING  ${dir} is inside another repository (${repoRoot(dir)}); not initialised`;
  const r = git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  return r.code === 0 ? `created  ${dir} (git init)` : `FAILED   git init in ${dir}: ${r.err}`;
}

function ensureLink(link, target) {
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() && fs.readlinkSync(link) === target) return `kept     ${link} -> ${target}`;
    return `WARNING  ${link} exists and is not the expected symlink; left alone`;
  }
  fs.symlinkSync(target, link);
  return `created  ${link} -> ${target}`;
}

function ensureExclude(repo, names) {
  // Resolved through Git rather than assumed as `.git/info/exclude`: callers
  // only reach here once `ensureRepo` has confirmed `.git` is a real
  // directory, but asking Git for its own metadata path is the version of
  // this that stays correct if that ever changes.
  const gitDir = git(['rev-parse', '--git-dir'], { cwd: repo }).out;
  const file = path.join(path.isAbsolute(gitDir) ? gitDir : path.join(repo, gitDir), 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const missing = names.filter((n) => !text.split('\n').includes(n));
  if (!missing.length) return `kept     ${file}`;
  fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  return `updated  ${file} (+${missing.join(', ')})`;
}

export function init(ws, { maintenance = false } = {}) {
  const log = [];
  if (fs.existsSync(path.join(ws, '.git'))) { log.push(`FAILED   ${ws} is itself a git repository; the layout needs a plain directory`); return log; }
  for (const d of ['scripts', 'worktrees']) { fs.mkdirSync(path.join(ws, d), { recursive: true }); }
  log.push(copyIfMissing(path.join(T, 'AGENTS.md'), path.join(ws, 'AGENTS.md')));
  log.push(copyIfMissing(path.join(T, 'new-worktree.sh'), path.join(ws, 'scripts', 'new-worktree.sh'), 0o755));
  const mainLine = ensureRepo(path.join(ws, 'main'));
  const docsLine = ensureRepo(path.join(ws, 'dev-docs'));
  log.push(mainLine, docsLine);
  // `WARNING`/`FAILED` already means "do not treat this directory as the
  // repository the rest of init() assumes it is" — continuing past it is
  // exactly what used to turn one bad repo (e.g. a linked worktree sitting
  // where main/ should be) into an uncaught crash a few lines later.
  const mainOk = /^(kept|created)/.test(mainLine);
  const docsOk = /^(kept|created)/.test(docsLine);
  if (mainOk) log.push(copyIfMissing(path.join(T, 'main.gitignore'), path.join(ws, 'main', '.gitignore')));
  if (docsOk) log.push(copyIfMissing(path.join(T, 'dev-docs.gitignore'), path.join(ws, 'dev-docs', '.gitignore')));
  if (mainOk) {
    log.push(ensureLink(path.join(ws, 'main', 'AGENTS.md'), '../AGENTS.md'));
    log.push(ensureLink(path.join(ws, 'main', 'CLAUDE.md'), '../AGENTS.md'));
    log.push(ensureExclude(path.join(ws, 'main'), ['AGENTS.md']));
  }
  if (maintenance) for (const [d, ok] of [['main', mainOk], ['dev-docs', docsOk]]) {
    if (!ok) continue;
    const r = git(['maintenance', 'start'], { cwd: path.join(ws, d) });
    log.push(`${r.code === 0 ? 'enabled ' : 'FAILED  '} git maintenance in ${d}${r.err ? ` (${r.err})` : ''}`);
  }
  log.push('note     .gitignore files must be in each repository\'s first commit; the gate checks HEAD, not the working tree');
  return log;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const ws = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
  if (!args.includes('--check')) for (const line of init(ws, { maintenance: args.includes('--maintenance') })) console.log(line);
  const r = spawnSync('sh', [GATE, ws], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
