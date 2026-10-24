import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function tmpdir(prefix = 'dev-office-test-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function gitRepo(dir, { commit = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  sh('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
  sh('git', ['config', 'user.name', 'test'], { cwd: dir });
  sh('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  if (commit) {
    fs.writeFileSync(path.join(dir, 'README.md'), 'test\n');
    sh('git', ['add', '.'], { cwd: dir });
    sh('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  }
  return dir;
}

export function withHome(home, fn) {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try { return fn(); } finally { process.env.HOME = prev; }
}
