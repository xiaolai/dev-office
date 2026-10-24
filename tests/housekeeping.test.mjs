import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, gitRepo, sh } from './helpers.mjs';
import { findJunk, trash, mergedBranches } from '../scripts/tidy.mjs';
import { summarize } from '../scripts/report.mjs';
import { adrDir, nextNumber, slugify, template } from '../scripts/adr.mjs';
import { init } from '../scripts/repo-init.mjs';

test('tidy finds junk outside skipped dirs, trashes by rename, lists only merged non-current branches', () => {
  const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(repo, 'src', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.DS_Store'), ''); fs.writeFileSync(path.join(repo, 'src', '.DS_Store'), ''); fs.writeFileSync(path.join(repo, 'src', 'node_modules', '.DS_Store'), '');
  assert.equal(findJunk(repo).length, 2);
  const t = tmpdir(); const dest = trash(path.join(repo, '.DS_Store'), t);
  assert.ok(fs.existsSync(dest)); assert.ok(!fs.existsSync(path.join(repo, '.DS_Store')));
  sh('git', ['branch', 'merged-one'], { cwd: repo });
  sh('git', ['checkout', '-q', '-b', 'unmerged'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'u.txt'), 'u'); sh('git', ['add', '.'], { cwd: repo }); sh('git', ['commit', '-q', '-m', 'u'], { cwd: repo });
  sh('git', ['checkout', '-q', 'main'], { cwd: repo });
  assert.deepEqual(mergedBranches(repo), { base: 'main', branches: ['merged-one'] });
});

test('trash never collides, even trashing two same-named files back to back', () => {
  const srcDir = tmpdir();
  fs.writeFileSync(path.join(srcDir, '.DS_Store'), 'first');
  const t = tmpdir();
  const dest1 = trash(path.join(srcDir, '.DS_Store'), t);
  fs.writeFileSync(path.join(srcDir, '.DS_Store'), 'second');
  const dest2 = trash(path.join(srcDir, '.DS_Store'), t);
  assert.notEqual(dest1, dest2);
  assert.equal(fs.readFileSync(dest1, 'utf8'), 'first', 'the first trashed file must survive the second trash of the same basename');
  assert.equal(fs.readFileSync(dest2, 'utf8'), 'second');
});

test("mergedBranches surfaces a failed git call instead of reporting an empty, 'nothing merged' list", () => {
  const repo = gitRepo(path.join(tmpdir(), 'r'));
  // A dangling refs/remotes/origin/HEAD: defaultBranch's symbolic-ref lookup
  // succeeds and returns the unverified name, which `branch --merged` then
  // fails to resolve ("malformed object name") — the default-branch helper
  // never checked that the name it returned actually exists.
  fs.mkdirSync(path.join(repo, '.git', 'refs', 'remotes', 'origin'), { recursive: true });
  sh('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/ghost'], { cwd: repo });
  const r = mergedBranches(repo);
  assert.equal(r.base, 'ghost');
  assert.deepEqual(r.branches, []);
  assert.match(r.error, /malformed object name|exited/);
});

test('report summarizes sessions and test tiers', () => {
  const s = summarize([
    { type: 'session', wall_s: 600, tokens: { input: 1, cache_read: 99, cache_create: 0, output: 100 }, agent_spawns: 2, instruction_lines: 100 },
    { type: 'session', wall_s: 1200, tokens: { input: 1, cache_read: 199, cache_create: 0, output: 200 }, agent_spawns: 0, instruction_lines: 80 },
    { type: 'session', error: 'x' },
    { type: 'test', tier: 'edit', duration_s: 10, exit: 0 }, { type: 'test', tier: 'edit', duration_s: 30, exit: 1 }, { type: 'test', tier: 'full', duration_s: 300, exit: 0 },
  ]);
  assert.equal(s.sessions.count, 2); assert.equal(s.sessions.errored, 1); assert.equal(s.sessions.median_wall_min, 15); assert.equal(s.sessions.median_tokens, 300);
  assert.equal(s.sessions.instruction_lines_latest, 80); assert.equal(s.sessions.tokens_per_instruction_line, 5);
  assert.deepEqual(s.tests.edit, { runs: 2, failures: 1, median_s: 20, total_min: 0.7 });
});

test("report: a tier literally named constructor does not crash summarize, and all-null wall times report as unmeasured, not zero", () => {
  const s = summarize([
    { type: 'session', wall_s: null, tokens: { input: 0, cache_read: 0, cache_create: 0, output: 0 }, agent_spawns: 0, instruction_lines: 10 },
    { type: 'test', tier: 'constructor', duration_s: 5, exit: 0 },
    { type: 'test', tier: '__proto__', duration_s: 5, exit: 0 },
  ]);
  assert.equal(s.sessions.median_wall_min, null, 'no session had a wall time; that is unmeasured, not a zero-minute session');
  assert.equal(s.tests.constructor.runs, 1);
  assert.equal(s.tests.__proto__.runs, 1);
});

test('adr picks the sibling dev-docs in a split workspace, numbers sequentially, slugs titles', () => {
  const ws = tmpdir(); gitRepo(path.join(ws, 'main')); gitRepo(path.join(ws, 'dev-docs'));
  assert.equal(adrDir({ adr: { dir: null } }, path.join(ws, 'main')), path.join(ws, 'dev-docs', 'adr'));
  const plain = gitRepo(path.join(tmpdir(), 'app'));
  assert.equal(adrDir({ adr: { dir: null } }, plain), path.join(plain, 'docs', 'adr'));
  assert.equal(adrDir({ adr: { dir: 'decisions' } }, plain), path.join(plain, 'decisions'));
  const d = tmpdir(); assert.equal(nextNumber(d), '0001'); fs.writeFileSync(path.join(d, '0007-x.md'), ''); assert.equal(nextNumber(d), '0008');
  assert.equal(slugify('Use SQLite, not Postgres!'), 'use-sqlite-not-postgres');
  assert.match(template('T', '2026-10-25'), /^# T\n\n- Status: proposed\n- Date: 2026-10-25/);
});

test('repo-init builds a workspace that passes the gate and is idempotent; the gate controls hold', () => {
  const ws = path.join(tmpdir(), 'ws');
  const first = init(ws);
  assert.ok(first.some((l) => l.startsWith('created') && l.includes('main (git init)')));
  const gate = new URL('../scripts/repo-init/gate.sh', import.meta.url).pathname;
  let r = spawnSync('sh', [gate, ws], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const second = init(ws);
  assert.ok(second.filter((l) => !l.startsWith('note')).every((l) => l.startsWith('kept')), second.join('\n'));
  const controls = spawnSync('sh', [new URL('../scripts/repo-init/gate-test.sh', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(controls.status, 0, controls.stdout + controls.stderr);
});
