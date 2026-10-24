import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, gitRepo, withHome } from './helpers.mjs';
import { summarizeTranscript, summarizeRollout, findRollout } from '../scripts/log-session.mjs';
import { instructionFiles, instructionTotal } from '../scripts/lib/instructions.mjs';

const fixture = new URL('./fixtures/transcript.jsonl', import.meta.url);
const rollout = new URL('./fixtures/rollout.jsonl', import.meta.url);

test('transcript summary dedupes usage by message id and counts human turns and spawns', () => {
  const s = summarizeTranscript(fs.readFileSync(fixture, 'utf8'));
  assert.equal(s.api_calls, 2, 'two API responses, one of them split over two lines');
  assert.deepEqual(s.tokens, { input: 40, cache_read: 300, cache_create: 5, output: 60 });
  assert.equal(s.turns, 2, 'tool results are not turns');
  assert.equal(s.agent_spawns, 1);
  assert.equal(s.wall_s, 180);
});

test('instruction files dedupe a symlinked AGENTS.md and include the plugin rules', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(home, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'a\nb\n\nc\n');
  fs.writeFileSync(path.join(home, '.claude', 'rules', 'x.md'), 'one\n');
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'p\nq\n');
  fs.symlinkSync('AGENTS.md', path.join(repo, 'CLAUDE.md'));
  const files = withHome(home, () => instructionFiles(repo, { home }));
  const names = files.map((f) => path.basename(f.file));
  assert.deepEqual(names, ['CLAUDE.md', 'x.md', 'CLAUDE.md', 'orchestration.md']);
  assert.equal(instructionTotal(files), 3 + 1 + 2 + 12);
});

test('log-session hook appends one record and exits 0 even without a transcript', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const script = new URL('../scripts/log-session.mjs', import.meta.url).pathname;
  const input = JSON.stringify({ session_id: 's1', cwd: repo, transcript_path: path.join(repo, 'missing.jsonl'), reason: 'exit' });
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const lines = fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.type, 'session'); assert.equal(rec.session_id, 's1'); assert.equal(rec.error, 'transcript_path missing');
  assert.ok(rec.instruction_lines >= 12);
  const r2 = spawnSync(process.execPath, [script], { input: JSON.stringify({ session_id: 's2', cwd: repo, transcript_path: fs.realpathSync(fixture) }), encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r2.status, 0);
  const rec2 = JSON.parse(fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim().split('\n')[1]);
  assert.equal(rec2.tokens.output, 60); assert.equal(rec2.error, undefined);
});

test('session-start prints the budget line and twelve rules, over-cap is named', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), Array(250).fill('x').join('\n') + '\n');
  const script = new URL('../scripts/session-start.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /instructions 262 lines across 2 files \(cap 200\) OVER by 62/);
  assert.equal((r.stdout.match(/^\d+\. /gm) || []).length, 12);
});

test('codex rollout summary takes the last cumulative token count and skips injected user blocks', () => {
  const s = summarizeRollout(fs.readFileSync(rollout, 'utf8'));
  assert.deepEqual(s.tokens, { input: 500, cache_read: 2500, cache_create: 0, output: 120 }, 'uncached input is input minus cached');
  assert.equal(s.turns, 2, 'AGENTS.md and angle-bracket blocks are not turns');
  assert.equal(s.agent_spawns, 1);
  assert.equal(s.token_count_events, 2);
  assert.equal(s.wall_s, 180);
});

test('codex host: instruction files are AGENTS.md chain plus rules, and log-session finds the rollout by session id', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  fs.mkdirSync(path.join(home, '.codex', 'sessions', '2026', '10', '25'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), 'g1\ng2\n');
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'p\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'ignored by codex\n');
  const files = withHome(home, () => instructionFiles(repo, { home, host: 'codex' }));
  assert.deepEqual(files.map((f) => path.basename(f.file)), ['AGENTS.md', 'AGENTS.md', 'orchestration.md']);
  assert.equal(instructionTotal(files), 2 + 1 + 12);
  const dst = path.join(home, '.codex', 'sessions', '2026', '10', '25', 'rollout-2026-10-25T01-00-00-thread-1.jsonl');
  fs.copyFileSync(rollout, dst);
  assert.equal(findRollout('thread-1', { home }), dst);
  assert.equal(findRollout('nope', { home }), null);
  const script = new URL('../scripts/log-session.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, '--host', 'codex'], { input: JSON.stringify({ session_id: 'thread-1', cwd: repo }), encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim());
  assert.equal(rec.host, 'codex'); assert.equal(rec.error, undefined); assert.equal(rec.tokens.output, 120); assert.equal(rec.instruction_lines, 15);
  const r2 = spawnSync(process.execPath, [script, '--host', 'codex'], { input: JSON.stringify({ session_id: 'nope', cwd: repo }), encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r2.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim().split('\n')[1]).error, 'rollout not found for session_id');
});

test('an unsupported --host is a logged error, not a crash: hostArg() runs inside the try now', () => {
  const home = tmpdir(); const repo = gitRepo(path.join(tmpdir(), 'r'));
  const script = new URL('../scripts/log-session.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, '--host', 'gemini'], { input: JSON.stringify({ session_id: 's1', cwd: repo }), encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(path.join(home, '.dev-office', 'log.jsonl'), 'utf8').trim());
  assert.equal(rec.host, null); assert.match(rec.error, /--host requires one of/);
});

test('summarizeTranscript dedupes a repeated Agent tool_use id and ignores a bare null record', () => {
  const lines = [
    '{"type":"assistant","timestamp":"2026-10-25T02:00:00.000Z","message":{"id":"m1","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Agent"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
    'null',
    // The same block re-emitted on a later line, as streaming snapshots do; same id, must count once.
    '{"type":"assistant","timestamp":"2026-10-25T02:00:01.000Z","message":{"id":"m1","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Agent"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
  ].join('\n');
  const s = summarizeTranscript(lines);
  assert.equal(s.agent_spawns, 1, 'one spawn id, seen twice, counts once');
});

test('summarizeRollout ignores a bare null record instead of crashing', () => {
  assert.doesNotThrow(() => summarizeRollout('null\n{"timestamp":"2026-10-25T02:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}'));
});
