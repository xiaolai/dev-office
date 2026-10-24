// dev-office report [--days N] [--json]
import { loadConfig } from './lib/config.mjs';
import { readLog, median } from './lib/log.mjs';
import { isMain } from './lib/main.mjs';

export function summarize(records) {
  const sessions = records.filter((r) => r.type === 'session' && !r.error);
  const errored = records.filter((r) => r.type === 'session' && r.error).length;
  const tests = records.filter((r) => r.type === 'test');
  const total = (s) => s.tokens ? s.tokens.input + s.tokens.cache_read + s.tokens.cache_create + s.tokens.output : null;
  // A Map, not a plain object: a tier literally named "constructor" would
  // read Object.prototype.constructor through `byTier[t.tier]` instead of
  // undefined, so `||=` would never create a bucket for it, and the next
  // line's `b.durations.push(...)` would crash on a function object that has
  // no `.durations`. A log record is written by this plugin's own scripts,
  // but nothing stops a tier name chosen by a project's `.dev-office.json`
  // from colliding with it.
  const byTier = new Map();
  for (const t of tests) {
    if (!byTier.has(t.tier)) byTier.set(t.tier, { runs: 0, failures: 0, durations: [] });
    const b = byTier.get(t.tier);
    b.runs += 1; if (t.exit !== 0) b.failures += 1; b.durations.push(t.duration_s);
  }
  const latest = sessions.at(-1);
  // median() returns null for an empty or all-non-numeric input. `?? 0`
  // turned "no measurement exists" into "the median wall time is zero
  // minutes" — indistinguishable from genuinely instantaneous sessions.
  const medianWall = sessions.length ? median(sessions.map((s) => s.wall_s)) : null;
  return {
    sessions: {
      count: sessions.length,
      errored,
      median_wall_min: medianWall !== null ? Math.round(medianWall / 6) / 10 : null,
      median_tokens: median(sessions.map(total)),
      median_output_tokens: median(sessions.map((s) => s.tokens?.output)),
      median_agent_spawns: median(sessions.map((s) => s.agent_spawns)),
      instruction_lines_latest: latest?.instruction_lines ?? null,
      tokens_per_instruction_line: latest && latest.instruction_lines && total(latest) ? Math.round(total(latest) / latest.instruction_lines) : null,
    },
    tests: Object.fromEntries([...byTier].map(([tier, b]) => [tier, { runs: b.runs, failures: b.failures, median_s: median(b.durations), total_min: Math.round(b.durations.reduce((a, c) => a + c, 0) / 6) / 10 }])),
  };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--days');
  const days = di >= 0 ? Number(args[di + 1]) : 7;
  // A missing or non-numeric value makes `days` NaN, which makes the log's
  // cutoff NaN too; `timestamp < NaN` is always false, so the filter would
  // silently keep every record ever logged instead of reporting a window. A
  // negative value asks for a cutoff in the future, which is not a window
  // either. Reject both rather than produce a report that looks scoped but is not.
  if (!Number.isFinite(days) || days < 0) { console.error(`dev-office report: --days must be a non-negative number (got ${JSON.stringify(args[di + 1])})`); process.exit(2); }
  const { config } = loadConfig();
  const records = readLog(config, { sinceDays: days });
  const s = summarize(records);
  if (args.includes('--json')) { process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(0); }
  console.log(`dev-office report: last ${days} days (${config.log.path})`);
  console.log('');
  console.log('| sessions | median wall (min) | median tokens | median output | median agent spawns | instruction lines | tokens per instruction line |');
  console.log('|---|---|---|---|---|---|---|');
  const x = s.sessions;
  console.log(`| ${x.count}${x.errored ? ` (+${x.errored} unmeasured)` : ''} | ${x.median_wall_min ?? '-'} | ${x.median_tokens ?? '-'} | ${x.median_output_tokens ?? '-'} | ${x.median_agent_spawns ?? '-'} | ${x.instruction_lines_latest ?? '-'} | ${x.tokens_per_instruction_line ?? '-'} |`);
  console.log('');
  const tiers = Object.entries(s.tests);
  if (!tiers.length) console.log('No test runs logged. Run tests through `dev-office test <tier>`.');
  else {
    console.log('| tier | runs | failures | median (s) | total (min) |');
    console.log('|---|---|---|---|---|');
    for (const [tier, b] of tiers) console.log(`| ${tier} | ${b.runs} | ${b.failures} | ${b.median_s} | ${b.total_min} |`);
    const quiet = tiers.filter(([, b]) => b.failures === 0 && b.runs >= 10).map(([t]) => t);
    if (quiet.length) console.log(`\nTiers with no failure in ${days} days over 10+ runs: ${quiet.join(', ')}. Candidates for review, not deletion.`);
  }
}
