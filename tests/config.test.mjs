import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir, gitRepo, withHome } from './helpers.mjs';
import { loadConfig, flatten } from '../scripts/lib/config.mjs';

test('four layers merge, later wins, provenance names the layer', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(home, '.dev-office'));
  fs.writeFileSync(path.join(home, '.dev-office', 'config.json'), JSON.stringify({ budget: { instruction_lines: 150 }, tests: { quarantine: [{ test: 'a', until: '2099-01-01' }] } }));
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ tests: { tiers: { edit: 'make quick' } } }));
  fs.writeFileSync(path.join(repo, '.dev-office.local.json'), JSON.stringify({ budget: { instruction_lines: 120 } }));
  const { config, provenance, files } = withHome(home, () => loadConfig(repo));
  assert.equal(config.budget.instruction_lines, 120);
  assert.equal(provenance.get('budget.instruction_lines'), 'repo-local');
  assert.equal(config.tests.tiers.edit, 'make quick');
  assert.equal(provenance.get('tests.tiers.edit'), 'repo');
  assert.equal(config.tests.tiers.full, null, 'untouched sibling keys survive a partial object override');
  assert.deepEqual(config.tests.quarantine, [{ test: 'a', until: '2099-01-01' }]);
  assert.equal(provenance.get('verifier.diff_lines_threshold'), 'defaults');
  assert.deepEqual(files.map((f) => f.name), ['defaults', 'user', 'repo', 'repo-local']);
  assert.ok(config.log.path.startsWith(home), 'log path expands ~ against HOME');
});

test('a repo or repo-local layer cannot redirect log.path or adr.dir', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const evil = path.join(tmpdir(), 'outside-the-repo');
  fs.writeFileSync(path.join(repo, '.dev-office.json'), JSON.stringify({ log: { path: path.join(evil, 'log.jsonl') }, adr: { dir: evil } }));
  fs.writeFileSync(path.join(repo, '.dev-office.local.json'), JSON.stringify({ log: { path: path.join(evil, 'local.jsonl') }, adr: { dir: evil } }));
  const { config, provenance } = withHome(home, () => loadConfig(repo));
  assert.ok(config.log.path.startsWith(home), 'log.path still comes from defaults, not a repo-controlled path');
  assert.equal(config.adr.dir, null, 'adr.dir still comes from defaults, not a repo-controlled path');
  assert.ok(!provenance.has('log.path') || provenance.get('log.path') !== 'repo', 'repo layer never wins provenance for log.path');
  assert.notEqual(provenance.get('adr.dir'), 'repo-local', 'repo-local layer never wins provenance for adr.dir');
});

test('invalid JSON in a layer fails loud with the file name', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.writeFileSync(path.join(repo, '.dev-office.json'), '{ nope');
  assert.throws(() => withHome(home, () => loadConfig(repo)), /\.dev-office\.json: invalid JSON/);
});

test('flatten produces dotted keys', () => {
  assert.deepEqual(flatten({ a: { b: 1, c: [1] }, d: null }), { 'a.b': 1, 'a.c': [1], d: null });
});
