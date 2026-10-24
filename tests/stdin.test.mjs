import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readHookInput, hostArg } from '../scripts/lib/stdin.mjs';

function withStdin(input, fn) {
  // readHookInput() reads fd 0 directly, so exercising it means actually
  // running a child process with the given stdin rather than mocking a module.
  const script = new URL('./fixtures/read-hook-input.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  return JSON.parse(r.stdout);
}

test('readHookInput treats non-object JSON (null, array, number) as absent, not as the value', () => {
  assert.deepEqual(withStdin('null'), {});
  assert.deepEqual(withStdin('[1,2,3]'), {});
  assert.deepEqual(withStdin('42'), {});
  assert.deepEqual(withStdin(''), {});
  assert.deepEqual(withStdin('not json'), {});
  assert.deepEqual(withStdin('{"cwd":"/tmp"}'), { cwd: '/tmp' });
});

test('hostArg defaults to claude, accepts codex, and rejects an unknown or missing value', () => {
  assert.equal(hostArg([]), 'claude');
  assert.equal(hostArg(['--host', 'codex']), 'codex');
  assert.throws(() => hostArg(['--host']), /--host requires one of/);
  assert.throws(() => hostArg(['--host', 'gemini']), /--host requires one of/);
  assert.throws(() => hostArg(['--host', '--other-flag']), /--host requires one of/);
});
