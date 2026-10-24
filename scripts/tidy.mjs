// dev-office tidy [--apply]
// Dry run by default. Nothing is removed with rm: junk goes to ~/.Trash,
// branches go only through `git branch -d` (merged only), worktrees through
// `git worktree prune`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { git, currentBranch, defaultBranch } from './lib/git.mjs';
import { isMain } from './lib/main.mjs';

const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', 'dist', 'build', '.pnpm-store']);

export function findJunk(root, name = '.DS_Store') {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name)); }
      else if (e.name === name) out.push(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

export function trash(file, trashDir = path.join(os.homedir(), '.Trash')) {
  fs.mkdirSync(trashDir, { recursive: true });
  // A millisecond timestamp is not unique: two files reaching this in the
  // same millisecond collided on the same destination name, and rename(2)
  // replaces its target silently, so the second trash overwrote the first.
  // mkdtemp's uniqueness is enforced by the OS at creation time, not by a
  // clock reading, so it holds regardless of how close together two calls land.
  const slot = fs.mkdtempSync(path.join(trashDir, `${path.basename(file)}.`));
  const dest = path.join(slot, path.basename(file));
  fs.renameSync(file, dest);
  return dest;
}

export function mergedBranches(root) {
  const base = defaultBranch(root);
  if (!base) return { base: null, branches: [] };
  const current = currentBranch(root);
  const r = git(['branch', '--merged', base, '--format=%(refname:short)'], { cwd: root });
  // An `error` key appears only here, never on the success path, so the
  // existing deepEqual-against-{base,branches} test is unaffected: the
  // failure this guards against is silent, not loud, so adding a visible
  // field precisely where it was previously missing is the fix.
  if (r.code !== 0) return { base, branches: [], error: r.err || `git branch --merged exited ${r.code}` };
  const branches = r.out.split('\n').map((s) => s.trim()).filter((b) => b && b !== base && b !== current);
  return { base, branches };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const { config, repo } = loadConfig();
  if (!repo) { console.error('dev-office tidy: not inside a git repository'); process.exit(2); }
  const t = config.tidy;
  const mode = apply ? 'apply' : 'dry run';
  console.log(`dev-office tidy (${mode}) in ${repo}`);

  if (t.ds_store) {
    const junk = findJunk(repo);
    if (!junk.length) console.log('  .DS_Store: none');
    for (const f of junk) {
      if (apply) console.log(`  .DS_Store: trashed ${path.relative(repo, f)} -> ${trash(f)}`);
      else console.log(`  .DS_Store: would trash ${path.relative(repo, f)}`);
    }
  }
  // A subprocess that fails but prints nothing previously read as "nothing to
  // prune" / "none merged" — a failure indistinguishable from legitimately
  // having no work to do. Each branch below now tells those apart and counts
  // failures so the script's own exit code reflects them.
  let failures = 0;
  if (t.worktree_prune) {
    const r = apply ? git(['worktree', 'prune', '-v'], { cwd: repo }) : git(['worktree', 'prune', '--dry-run', '-v'], { cwd: repo });
    if (r.code !== 0) { console.log(`  worktrees: failed: ${r.err || `exit ${r.code}`}`); failures += 1; }
    else console.log(`  worktrees: ${r.out || r.err || 'nothing to prune'}`);
  }
  if (t.merged_branches) {
    const { base, branches, error } = mergedBranches(repo);
    if (error) { console.log(`  branches: could not list merged branches: ${error}`); failures += 1; }
    else if (!base) console.log('  branches: no default branch found; skipped');
    else if (!branches.length) console.log(`  branches: none merged into ${base}`);
    for (const b of branches) {
      if (apply) {
        const r = git(['branch', '-d', b], { cwd: repo });
        console.log(`  branches: ${r.code === 0 ? 'deleted' : 'could not delete'} ${b}${r.err ? ` (${r.err})` : ''}`);
        if (r.code !== 0) failures += 1;
      } else console.log(`  branches: would delete ${b} (merged into ${base})`);
    }
  }
  if (t.maintenance) {
    if (apply) {
      const r = git(['maintenance', 'run', '--auto'], { cwd: repo });
      console.log(`  maintenance: ${r.code === 0 ? 'ran' : `failed: ${r.err}`}`);
      if (r.code !== 0) failures += 1;
    } else console.log('  maintenance: would run `git maintenance run --auto`');
  }
  const report = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.mjs'), '--days', '30'], { encoding: 'utf8' });
  process.stdout.write('\n' + (report.stdout || report.stderr));
  if (!apply) console.log('\nRe-run with --apply to perform the listed actions.');
  if (failures) { console.error(`\ndev-office tidy: ${failures} step(s) failed`); process.exit(1); }
}
