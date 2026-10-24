import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, gitRepo } from './helpers.mjs';
import { detectStack, resolveTier, expiredQuarantine } from '../scripts/test.mjs';

const base = { tests: { tiers: { edit: null, pr: null, full: null }, journeys_command: null, quarantine: [] } };

test('stack detection prefers the test runner in package.json, then other manifests', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ devDependencies: { vitest: '1' } }));
  assert.equal(detectStack(d).name, 'vitest');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'tap' } }));
  assert.equal(detectStack(d).edit, 'npm test');
  fs.unlinkSync(path.join(d, 'package.json')); fs.writeFileSync(path.join(d, 'go.mod'), 'module x\n');
  assert.equal(detectStack(d).name, 'go');
  assert.equal(detectStack(tmpdir()), null);
});

test('configured tier wins over detection; pr adds journeys only when configured', () => {
  const d = tmpdir(); fs.writeFileSync(path.join(d, 'go.mod'), 'module x\n');
  assert.equal(resolveTier(base, d, 'edit').cmd, 'go test ./...');
  const cfg = JSON.parse(JSON.stringify(base)); cfg.tests.tiers.edit = 'make fast'; cfg.tests.journeys_command = 'make journeys';
  assert.equal(resolveTier(cfg, d, 'edit').cmd, 'make fast');
  assert.equal(resolveTier(cfg, d, 'pr').cmd, 'go test ./... && make journeys');
  assert.throws(() => resolveTier(base, tmpdir(), 'full'), /set tests\.tiers\.full/);
  assert.throws(() => resolveTier(base, d, 'nightly'), /unknown tier/);
});

test('quarantine entries past their date are expired, missing dates count as expired', () => {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.tests.quarantine = [{ test: 'old', until: '2020-01-01' }, { test: 'ok', until: '2099-01-01' }, { test: 'nodate' }];
  assert.deepEqual(expiredQuarantine(cfg, new Date('2026-10-25')).map((q) => q.test), ['old', 'nodate']);
});

test('a malformed quarantine date is expired, not an indefinite exemption', () => {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.tests.quarantine = [
    { test: 'words', until: 'tomorrow' },     // 't' > '2' lexically: a bare string compare called this "not expired"
    { test: 'bad-calendar', until: '2026-02-30' }, // not a real date; `new Date()` would silently roll it to March
    { test: 'valid-future', until: '2099-01-01' },
  ];
  assert.deepEqual(expiredQuarantine(cfg, new Date('2026-10-25')).map((q) => q.test), ['words', 'bad-calendar']);
});

test('the test command runs, logs runtime and exit code, and refuses on expired quarantine', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const script = new URL('../scripts/test.mjs', import.meta.url).pathname;
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ tests: { tiers: { edit: 'exit 3' } } }));
  const env = { ...process.env, HOME: home };
  let r = spawnSync(process.execPath, [script, 'edit'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(r.status, 3, 'exit code of the test command propagates');
  const rec = JSON.parse(fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim());
  assert.equal(rec.type, 'test'); assert.equal(rec.tier, 'edit'); assert.equal(rec.exit, 3); assert.equal(typeof rec.duration_s, 'number');
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ tests: { tiers: { edit: 'true' }, quarantine: [{ test: 'x', until: '2000-01-01' }] } }));
  r = spawnSync(process.execPath, [script, 'edit'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(r.status, 2); assert.match(r.stderr, /quarantine entries past their date/);
});

test('extra args reach the command as literal argv, not re-parsed shell text', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const script = new URL('../scripts/test.mjs', import.meta.url).pathname;
  // `printf '%s\n' "$@"` just echoes argv back; if the extra were ever
  // string-concatenated into the shell command instead of passed as a real
  // argument, the semicolon would end that command and `touch` would run.
  const marker = path.join(repo, 'should-not-exist');
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ tests: { tiers: { edit: `printf '%s\\n' "$@" >&2` } } }));
  const env = { ...process.env, HOME: home };
  const r = spawnSync(process.execPath, [script, 'edit', '--', `;touch ${marker};`], { cwd: repo, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(marker), 'the injected command must not have run');
  assert.match(r.stderr, /;touch .*should-not-exist;/, 'the argument arrived as one literal word, not shell syntax');
});

test('a log-write failure is reported, but still exits with the test command\'s own code', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const script = new URL('../scripts/test.mjs', import.meta.url).pathname;
  // A plain file where the log's parent directory needs to be: appendLog's
  // mkdirSync on it throws, while config loading itself (which only reads
  // ~/.dev-office/config.json, not the log path) is unaffected.
  fs.writeFileSync(path.join(home, 'blocked'), 'not a directory');
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ tests: { tiers: { edit: 'exit 0' } }, log: { path: path.join(home, 'blocked', 'log.jsonl') } }));
  const env = { ...process.env, HOME: home };
  const r = spawnSync(process.execPath, [script, 'edit'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(r.status, 0, 'the test itself passed; a logging failure must not turn that into a crash');
  assert.match(r.stderr, /could not record this run in the log/);
  assert.match(r.stdout, /exit 0 in/);
});
