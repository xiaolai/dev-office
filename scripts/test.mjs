// dev-office test <edit|pr|full> [--dry-run] [-- extra args]
// Resolves the tier command from config or stack detection, refuses to run when
// a quarantine entry has expired, runs, and logs the runtime.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { appendLog } from './lib/log.mjs';
import { isMain } from './lib/main.mjs';

const TIERS = ['edit', 'pr', 'full'];

export function detectStack(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('package.json')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.vitest) return { name: 'vitest', edit: 'npx vitest run --changed', full: 'npx vitest run' };
    if (deps.jest) return { name: 'jest', edit: 'npx jest --onlyChanged', full: 'npx jest' };
    if (pkg.scripts && pkg.scripts.test) return { name: 'npm', edit: 'npm test', full: 'npm test' };
  }
  if (has('go.mod')) return { name: 'go', edit: 'go test ./...', full: 'go test -count=1 ./...' };
  if (has('Cargo.toml')) return { name: 'cargo', edit: 'cargo test', full: 'cargo test' };
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg')) return { name: 'pytest', edit: 'pytest -q -x', full: 'pytest -q' };
  if (has('Package.swift')) return { name: 'swift', edit: 'swift test', full: 'swift test' };
  return null;
}

export function resolveTier(config, root, tier) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier ${tier}; expected one of ${TIERS.join(', ')}`);
  const configured = config.tests.tiers[tier];
  if (configured) return { cmd: configured, source: 'config' };
  const stack = detectStack(root);
  if (!stack) throw new Error(`no test command for tier ${tier}: set tests.tiers.${tier} in .dev-office.json (no known stack detected)`);
  if (tier === 'edit') return { cmd: stack.edit, source: `detected ${stack.name}` };
  if (tier === 'full') return { cmd: stack.full, source: `detected ${stack.name}` };
  const journeys = config.tests.journeys_command;
  return { cmd: journeys ? `${stack.edit} && ${journeys}` : stack.edit, source: `detected ${stack.name}${journeys ? ' + journeys' : ' (no journeys_command configured)'}` };
}

// Canonical YYYY-MM-DD and a real calendar date: `new Date(s)` normalizes an
// invalid date like 2026-02-30 forward to March rather than rejecting it, so
// the round-trip through toISOString is what actually catches that.
function isValidQuarantineDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function expiredQuarantine(config, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  // A missing `until`, an unparseable one like "tomorrow", or one that is
  // simply in the past: all three must fail open to "expired", not grant an
  // indefinite exemption. A bare string comparison treated "tomorrow" as not
  // expired only because 't' sorts after '2' — comparing format-invalid
  // strings answered a question that was never actually asked.
  return (config.tests.quarantine || []).filter((q) => !q.until || !isValidQuarantineDate(q.until) || q.until < day);
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const sep = args.indexOf('--');
  const extra = sep >= 0 ? args.slice(sep + 1) : [];
  const own = sep >= 0 ? args.slice(0, sep) : args;
  const dryRun = own.includes('--dry-run');
  const tier = own.find((a) => !a.startsWith('--'));
  if (!tier) { console.error('usage: dev-office test <edit|pr|full> [--dry-run] [-- args]'); process.exit(2); }
  const { config, repo } = loadConfig();
  if (!repo) { console.error('dev-office test: not inside a git repository'); process.exit(2); }
  let resolved;
  try { resolved = resolveTier(config, repo, tier); } catch (e) { console.error(`dev-office test: ${e.message}`); process.exit(2); }
  const expired = expiredQuarantine(config);
  if (expired.length) {
    console.error('dev-office test: refusing to run; quarantine entries past their date:');
    for (const q of expired) console.error(`  ${q.test}  until ${q.until ?? '(none)'}  issue ${q.issue ?? '-'}`);
    console.error('Fix the test or extend the entry with a reason. Quarantine is a loan, not a home.');
    process.exit(2);
  }
  const active = config.tests.quarantine || [];
  if (active.length) { console.log('dev-office test: quarantined (excluded by you, not by this tool):'); for (const q of active) console.log(`  ${q.test}  until ${q.until}`); }
  const cmd = resolved.cmd;
  // Extras are forwarded as real argv entries via `sh -c 'cmd "$@"' sh ...`,
  // not joined into the command string: `extra.join(' ')` let a quoted
  // argument's own content (`;`, `&&`, `$(...)`, a backtick) be re-parsed as
  // shell syntax rather than passed through literally. `"$@"` appends them
  // after whatever is LAST in `cmd` — if a tier's command is a chain like
  // `A && B`, extras go to B. That is the same place the old string-concat
  // put them; this only changes how they arrive, not where.
  console.log(`dev-office test ${tier}: ${cmd}${extra.length ? ' ' + extra.map((a) => JSON.stringify(a)).join(' ') : ''}  [${resolved.source}]`);
  if (dryRun) process.exit(0);
  const started = Date.now();
  const r = extra.length
    ? spawnSync('sh', ['-c', `${cmd} "$@"`, 'sh', ...extra], { cwd: repo, stdio: 'inherit' })
    : spawnSync('sh', ['-c', cmd], { cwd: repo, stdio: 'inherit' });
  const duration_s = Math.round((Date.now() - started) / 10) / 100;
  const code = r.status === null ? 1 : r.status;
  // A failure to WRITE the log (disk full, permission denied) must not look
  // like the TEST failed: previously an uncaught throw here skipped both the
  // result line and `process.exit(code)`, so a passing run with a log
  // problem reported as an unexplained crash instead of as pass-with-a-caveat.
  try { appendLog(config, { type: 'test', repo, tier, cmd, duration_s, exit: code }); }
  catch (e) { console.error(`dev-office test: could not record this run in the log: ${e.message}`); }
  console.log(`dev-office test ${tier}: exit ${code} in ${duration_s}s`);
  process.exit(code);
}
