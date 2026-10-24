import { spawnSync } from 'node:child_process';

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return { code: r.status, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trimEnd() };
}

export function repoRoot(cwd = process.cwd()) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).out;
}

export function defaultBranch(cwd) {
  const r = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd });
  if (r.code === 0 && r.out) return r.out.replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', name], { cwd }).code === 0) return name;
  }
  return null;
}

export function mustSucceed(result, what) {
  if (result.code !== 0) throw new Error(`${what} failed (exit ${result.code})${result.err ? `: ${result.err}` : ''}`);
  return result;
}
