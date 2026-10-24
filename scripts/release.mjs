// dev-office release <version> [--push] [--skip-tests]
// Preflight, then an annotated tag written from a file (never a shell-parsed
// message). Pushing is outward-facing and happens only with --push.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { git, currentBranch, defaultBranch, mustSucceed } from './lib/git.mjs';
import { isMain } from './lib/main.mjs';

// The canonical SemVer 2.0.0 regex (semver.org/#is-there-a-suggested-regular-expression-suitable-for-checking-a-semver-string):
// no leading zeros in numeric identifiers (so `01.2.3` and `1.2.3-01` are
// rejected), and empty prerelease/build identifiers are rejected too.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function preflight({ root, version, config }) {
  const problems = [];
  if (!SEMVER.test(version)) problems.push(`version ${version} is not semver (MAJOR.MINOR.PATCH[-pre][+build])`);
  const tag = `${config.release.tag_prefix}${version}`;
  if (git(['status', '--porcelain'], { cwd: root }).out) problems.push('working tree is not clean');
  const branch = currentBranch(root);
  const base = defaultBranch(root);
  if (base && branch !== base) problems.push(`on branch ${branch}, not the default ${base}`);
  if (git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root }).code === 0) problems.push(`tag ${tag} already exists`);
  const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root });
  if (up.code === 0) {
    // An ignored fetch failure (network down, auth expired) leaves @{u} at its
    // last-known state, so "0 commits behind" would mean "couldn't check" as
    // often as it means "actually current" — the two are not distinguishable
    // without looking at the fetch's own exit code.
    const fetched = git(['fetch', '--quiet'], { cwd: root });
    if (fetched.code !== 0) problems.push(`could not fetch ${up.out.split('/')[0]} to verify freshness: ${fetched.err || 'unknown error'}`);
    else {
      const behind = Number(git(['rev-list', '--count', 'HEAD..@{u}'], { cwd: root }).out || 0);
      if (behind > 0) problems.push(`branch is ${behind} commit(s) behind ${up.out}`);
    }
  }
  const changelog = path.join(root, config.release.changelog);
  if (fs.existsSync(changelog)) {
    const text = fs.readFileSync(changelog, 'utf8');
    // A trailing boundary after the optional `]` stops "## 1.2.3" from
    // matching the heading for "1.2.30" or "1.2.3-rc.1" — `test()` on the
    // unanchored original accepted either as evidence this version's section
    // exists.
    const heading = new RegExp(`^##\\s+\\[?v?${version.replace(/[.+-]/g, '\\$&')}\\]?(?:\\s|$)`, 'm');
    if (!heading.test(text)) problems.push(`${config.release.changelog} has no "## ${version}" section`);
  }
  return { tag, problems, commit: problems.length ? null : git(['rev-parse', 'HEAD'], { cwd: root }).out };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith('--'));
  if (!version) { console.error('usage: dev-office release <version> [--push] [--skip-tests]'); process.exit(2); }
  const { config, repo } = loadConfig();
  if (!repo) { console.error('dev-office release: not inside a git repository'); process.exit(2); }
  const { tag, problems, commit } = preflight({ root: repo, version, config });
  if (problems.length) { console.error('dev-office release: preflight failed'); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
  console.log(`dev-office release: preflight passed for ${tag} at ${commit}`);
  if (args.includes('--skip-tests')) console.log('dev-office release: tests skipped by flag (recorded in the tag message)');
  else {
    const t = spawnSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev-office'), ['test', 'full'], { cwd: repo, stdio: 'inherit' });
    if (t.status !== 0) { console.error(`dev-office release: full test tier failed (exit ${t.status}); no tag created`); process.exit(1); }
  }
  // The test run can take minutes; recheck that the preflighted commit and a
  // clean tree still hold, and tag that exact commit rather than whatever
  // HEAD happens to be by now — otherwise a commit or amend made (by this
  // process or another) during the test run would be tagged unreviewed.
  const nowHead = git(['rev-parse', 'HEAD'], { cwd: repo }).out;
  if (nowHead !== commit) { console.error(`dev-office release: HEAD moved from ${commit} to ${nowHead} during the test run; no tag created`); process.exit(1); }
  if (git(['status', '--porcelain'], { cwd: repo }).out) { console.error('dev-office release: working tree became dirty during the test run; no tag created'); process.exit(1); }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-office-release-'));
  try {
    const msgFile = path.join(tmpDir, 'tag-message.txt');
    fs.writeFileSync(msgFile, `Release ${tag}\n\nCreated by dev-office release.${args.includes('--skip-tests') ? ' Tests were skipped by flag.' : ' Full test tier passed.'}\n`);
    mustSucceed(git(['tag', '-a', tag, commit, '-F', msgFile], { cwd: repo }), 'git tag');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(`dev-office release: tagged ${tag}`);
  if (args.includes('--push')) {
    mustSucceed(git(['push', 'origin', currentBranch(repo)], { cwd: repo }), 'git push branch');
    mustSucceed(git(['push', 'origin', tag], { cwd: repo }), 'git push tag');
    console.log(`dev-office release: pushed ${tag}; CI takes it from here`);
  } else {
    console.log(`Not pushed. When ready: git push origin ${currentBranch(repo)} && git push origin ${tag}`);
  }
}
