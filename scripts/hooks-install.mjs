// dev-office hooks-install
// A repository that sets its own core.hooksPath, or uses husky, never runs the
// global hooks in ~/.git-hooks. This prepends a call to them in each of the
// repository's hook files, once, behind a marker, so the same commit-message
// and staged-content checks apply everywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { git } from './lib/git.mjs';
import { isMain } from './lib/main.mjs';

export const MARKER = '# dev-office: global hooks';
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];

export function block(hook) {
  if (hook === 'pre-push') {
    // pre-push receives the ref list on stdin; both the global and the local
    // hook must see it, so it is captured once and replayed. mktemp and cat
    // can each fail (disk full, no /tmp access); either failure must abort
    // the push rather than silently falling through with an empty or missing
    // ref list reaching the hooks.
    return `${MARKER} (installed by dev-office hooks-install; keep first)
if [ -x "$HOME/.git-hooks/pre-push" ]; then
  _dev_office_in=$(mktemp) || { echo "dev-office: mktemp failed" >&2; exit 1; }
  cat >"$_dev_office_in" || { rm -f "$_dev_office_in"; echo "dev-office: failed to capture pre-push input" >&2; exit 1; }
  "$HOME/.git-hooks/pre-push" "$@" <"$_dev_office_in" || { rm -f "$_dev_office_in"; exit 1; }
  exec <"$_dev_office_in"
  rm -f "$_dev_office_in"
fi
`;
  }
  return `${MARKER} (installed by dev-office hooks-install; keep first)
if [ -x "$HOME/.git-hooks/${hook}" ]; then "$HOME/.git-hooks/${hook}" "$@" || exit $?; fi
`;
}

// Interpreters whose scripts can safely host a leading POSIX `if [ -x ... ]`
// block. An existing hook under an interpreter outside this set (python,
// node, perl, ruby, ...) would be corrupted by inserting shell syntax after
// its shebang, so installation into that file is refused instead.
const SHELL_SHEBANG = /^#!.*\/(env\s+)?(sh|bash|dash|zsh|ksh)\b/;

export function localHooksDir(root) {
  // `--path` applies git's own tilde/path expansion (the same expansion git
  // itself uses to resolve core.hooksPath), so a value like `~/hooks` or a
  // relative path is not treated as a literal subdirectory of the repo.
  const r = git(['config', '--path', '--local', '--get', 'core.hooksPath'], { cwd: root });
  if (r.code === 0 && r.out) return { dir: path.resolve(root, r.out), why: `core.hooksPath=${r.out}` };
  if (fs.existsSync(path.join(root, '.husky'))) return { dir: path.join(root, '.husky'), why: 'husky directory present' };
  return null;
}

export function installInto(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const hook of HOOKS) {
    const file = path.join(dir, hook);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (text.includes(MARKER)) { results.push({ hook, action: 'already installed' }); continue; }
    if (!text) text = '#!/bin/sh\n';
    const lines = text.split('\n');
    const hasShebang = lines[0].startsWith('#!');
    if (hasShebang && !SHELL_SHEBANG.test(lines[0])) {
      results.push({ hook, action: `skipped: non-shell interpreter (${lines[0]})` });
      continue;
    }
    const insertAt = hasShebang ? 1 : 0;
    lines.splice(insertAt, 0, block(hook).trimEnd());
    fs.writeFileSync(file, lines.join('\n'));
    fs.chmodSync(file, 0o755);
    results.push({ hook, action: fs.existsSync(file) && text !== '#!/bin/sh\n' ? 'prepended' : 'created' });
  }
  return results;
}

if (isMain(import.meta.url)) {
  const { repo } = loadConfig();
  if (!repo) { console.error('dev-office hooks-install: not inside a git repository'); process.exit(2); }
  const globalDir = path.join(os.homedir(), '.git-hooks');
  const missing = HOOKS.filter((h) => { try { fs.accessSync(path.join(globalDir, h), fs.constants.X_OK); return false; } catch { return true; } });
  if (missing.length) { console.error(`dev-office hooks-install: global hooks missing or not executable in ${globalDir}: ${missing.join(', ')}`); process.exit(2); }
  const local = localHooksDir(repo);
  if (!local) {
    const g = git(['config', '--global', '--get', 'core.hooksPath']).out;
    if (g && path.resolve(g.replace(/^~/, os.homedir())) === globalDir) console.log(`dev-office hooks-install: ${repo} uses the global hooks path; nothing to install`);
    else { console.error(`dev-office hooks-install: no repo hooks path and global core.hooksPath is ${g || 'unset'}; set it to ${globalDir}`); process.exit(1); }
    process.exit(0);
  }
  // A repo-local hooksPath (or an alias of it, e.g. a symlink) that resolves
  // to the same directory as ~/.git-hooks would otherwise have each global
  // hook prepended with a call into itself: infinite recursion at run time.
  let localReal = local.dir, globalReal = globalDir;
  try { localReal = fs.realpathSync(local.dir); } catch { /* dir may not exist yet; compare the resolved path as-is */ }
  try { globalReal = fs.realpathSync(globalDir); } catch { /* ~/.git-hooks already checked executable above; this is belt-and-suspenders */ }
  if (localReal === globalReal) { console.log(`dev-office hooks-install: ${local.why} resolves to the global hooks directory itself; nothing to install`); process.exit(0); }
  console.log(`dev-office hooks-install: ${local.why}; chaining global hooks into ${path.relative(repo, local.dir) || '.'}`);
  for (const r of installInto(local.dir)) console.log(`  ${r.hook.padEnd(12)} ${r.action}`);
}
