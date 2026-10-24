import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, gitRepo, sh } from './helpers.mjs';
import { audit } from '../scripts/env-audit.mjs';
import { installInto, localHooksDir, MARKER } from '../scripts/hooks-install.mjs';
import { preflight } from '../scripts/release.mjs';

test('env audit flags by name and by value shape, never prints values, honours allow list', () => {
  const env = { HOME: '/x', PATH: '/usr/bin:/bin', MY_API_KEY: 'short', PLAIN: 'ghp_' + 'a'.repeat(30), LONG: 'A'.repeat(48), SSH_AUTH_SOCK: '/tmp/s', JWT: 'eyJabcdefghijk.eyJabcdefghijk.sig', ALLOWED_TOKEN: 'x' };
  const f = audit(env, ['ALLOWED_TOKEN']);
  assert.deepEqual(f.map((x) => [x.name, x.matched]), [['JWT', 'value'], ['LONG', 'value'], ['MY_API_KEY', 'name'], ['PLAIN', 'value']]);
  assert.ok(!JSON.stringify(f).includes('ghp_'), 'values are not in the findings');
});

test('hooks-install chains global hooks once, keeps the shebang first, and the chain blocks a commit', () => {
  const home = tmpdir();
  fs.mkdirSync(path.join(home, '.git-hooks'));
  for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
    fs.writeFileSync(path.join(home, '.git-hooks', h), `#!/bin/sh\necho "global ${h} ran" >> "$HOME/ran.txt"\n${h === 'commit-msg' ? 'grep -q FORBIDDEN "$1" && exit 1\n' : ''}exit 0\n`, { mode: 0o755 });
  }
  const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(repo, '.husky'));
  fs.writeFileSync(path.join(repo, '.husky', 'commit-msg'), '#!/bin/sh\necho local >> "$HOME/ran.txt"\n');
  sh('git', ['config', 'core.hooksPath', '.husky'], { cwd: repo });
  assert.match(localHooksDir(repo).why, /core\.hooksPath/);
  const first = installInto(path.join(repo, '.husky'));
  assert.deepEqual(first.map((r) => r.action), ['created', 'prepended', 'created']);
  const second = installInto(path.join(repo, '.husky'));
  assert.ok(second.every((r) => r.action === 'already installed'));
  const text = fs.readFileSync(path.join(repo, '.husky', 'commit-msg'), 'utf8');
  assert.ok(text.startsWith('#!/bin/sh\n' + MARKER)); assert.equal(text.split(MARKER).length, 2);
  const env = { ...process.env, HOME: home };
  fs.writeFileSync(path.join(repo, 'f.txt'), '1');
  sh('git', ['add', 'f.txt'], { cwd: repo });
  let r = spawnSync('git', ['commit', '-q', '-m', 'has FORBIDDEN word'], { cwd: repo, encoding: 'utf8', env });
  assert.notEqual(r.status, 0, 'global commit-msg hook blocked the commit through the chain');
  r = spawnSync('git', ['commit', '-q', '-m', 'clean'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const ran = fs.readFileSync(path.join(home, 'ran.txt'), 'utf8');
  assert.match(ran, /global pre-commit ran/); assert.match(ran, /global commit-msg ran/); assert.match(ran, /local/);
});

test('release preflight names every problem and passes on a clean default branch', () => {
  const repo = gitRepo(path.join(tmpdir(), 'r'));
  const config = { release: { tag_prefix: 'v', changelog: 'CHANGELOG.md' } };
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## 0.9.0\n- old\n');
  sh('git', ['add', '.'], { cwd: repo }); sh('git', ['commit', '-q', '-m', 'changelog'], { cwd: repo });
  sh('git', ['tag', 'v1.0.0'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
  sh('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
  const bad = preflight({ root: repo, version: '1.0.0', config });
  assert.equal(bad.tag, 'v1.0.0');
  assert.deepEqual(bad.problems, ['working tree is not clean', 'on branch feature, not the default main', 'tag v1.0.0 already exists', 'CHANGELOG.md has no "## 1.0.0" section']);
  assert.match(preflight({ root: repo, version: 'one', config }).problems[0], /not semver/);
  fs.unlinkSync(path.join(repo, 'dirty.txt')); sh('git', ['checkout', '-q', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## 1.1.0\n- new\n\n## 0.9.0\n- old\n');
  sh('git', ['commit', '-q', '-am', 'changelog'], { cwd: repo });
  assert.deepEqual(preflight({ root: repo, version: '1.1.0', config }).problems, []);
});
