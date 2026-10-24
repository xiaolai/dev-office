// SessionEnd hook. Appends one record: wall time, turns, agent spawns, tokens,
// instruction lines. Claude Code names the transcript in the hook input. Codex
// does not, so the rollout file is found by session id under ~/.codex/sessions.
// Never exits non-zero: a failed measurement is logged as such, not raised.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { appendLog } from './lib/log.mjs';
import { instructionFiles, instructionTotal } from './lib/instructions.mjs';
import { readHookInput, hostArg } from './lib/stdin.mjs';
import { isMain } from './lib/main.mjs';

// Shared by both summarizers: split into non-blank lines, parse each as JSON,
// skip anything that is not a genuine record (parse failure, or valid JSON
// that is `null`/an array/a bare value rather than an object), and track the
// first/last timestamp seen across every record that has a parseable one.
// Each summarizer still walks `records` itself for its own host-specific
// fields; this only removes the two ways that walk was previously repeated
// line-for-line, including the same missing null-record guard in both.
function forEachRecord(text, fn) {
  let first = null, last = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
    if (Number.isFinite(ts)) { if (first === null || ts < first) first = ts; if (last === null || ts > last) last = ts; }
    fn(o);
  }
  return { first, last };
}

export function summarizeTranscript(text) {
  const usageById = new Map();
  const spawnIds = new Set();
  let turns = 0, agentSpawnsUnidentified = 0;
  const { first, last } = forEachRecord(text, (o) => {
    const m = o.message;
    if (!m || typeof m !== 'object') return;
    const content = m.content;
    if (o.type === 'user' || m.role === 'user') {
      const isToolResult = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      const isSystemish = typeof content === 'string' && content.startsWith('<');
      if (!isToolResult && !isSystemish && !o.isMeta) turns += 1;
    }
    if (o.type === 'assistant' || m.role === 'assistant') {
      if (m.usage) usageById.set(m.id ?? o.uuid, m.usage);
      if (Array.isArray(content)) for (const b of content) {
        if (!b || b.type !== 'tool_use' || b.name !== 'Agent') continue;
        // The same logical assistant turn can appear on more than one JSONL
        // line as content streams in, the same way usage is keyed by message
        // id above; without deduping by the block's own id, a spawn counted
        // once per re-emitted line inflates the total.
        if (b.id) spawnIds.add(b.id); else agentSpawnsUnidentified += 1;
      }
    }
  });
  const tokens = { input: 0, cache_read: 0, cache_create: 0, output: 0 };
  for (const u of usageById.values()) {
    tokens.input += u.input_tokens || 0;
    tokens.cache_read += u.cache_read_input_tokens || 0;
    tokens.cache_create += u.cache_creation_input_tokens || 0;
    tokens.output += u.output_tokens || 0;
  }
  return {
    wall_s: first !== null && last !== null ? Math.round((last - first) / 1000) : null,
    turns,
    agent_spawns: spawnIds.size + agentSpawnsUnidentified,
    api_calls: usageById.size,
    tokens,
  };
}

// Codex rollout: one JSON object per line with a top-level timestamp. Token usage
// arrives as cumulative `token_count` events, so the last one is the session total.
// User turns are `response_item` messages with role user whose text is not an
// injected AGENTS.md block or other angle-bracketed context.
export function summarizeRollout(text) {
  let turns = 0, agentSpawns = 0, usage = null, counts = 0;
  const { first, last } = forEachRecord(text, (o) => {
    const p = o.payload;
    if (!p || typeof p !== 'object') return;
    // `counts` below is how many token_count events arrived, not how many
    // model calls were made: Codex has no request identifier in this stream
    // to count calls by, and a token_count event is not documented to fire
    // exactly once per call. Reported as `token_count_events`, not folded
    // into `api_calls`, so it is not read as a number it was never shown to be.
    if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) { usage = p.info.total_token_usage; counts += 1; }
    if (o.type === 'response_item' && p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      const t = p.content.map((c) => c?.text || '').join('');
      if (t && !t.startsWith('<') && !t.startsWith('# AGENTS.md instructions')) turns += 1;
    }
    if (o.type === 'response_item' && p.type === 'function_call' && /spawn_agent|thread_spawn/.test(p.name || '')) agentSpawns += 1;
  });
  return {
    wall_s: first !== null && last !== null ? Math.round((last - first) / 1000) : null,
    turns,
    agent_spawns: agentSpawns,
    token_count_events: counts,
    tokens: usage ? {
      input: (usage.input_tokens || 0) - (usage.cached_input_tokens || 0),
      cache_read: usage.cached_input_tokens || 0,
      cache_create: usage.cache_write_input_tokens || 0,
      output: usage.output_tokens || 0,
    } : null,
  };
}

export function findRollout(sessionId, { home = os.homedir() } = {}) {
  if (!sessionId) return null;
  const root = path.join(home, '.codex', 'sessions');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith(`-${sessionId}.jsonl`)) return p;
    }
  }
  return null;
}

if (isMain(import.meta.url)) {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  // hostArg() now rejects an unrecognized --host instead of silently taking
  // the Claude branch; it must run inside the try so that rejection becomes
  // a logged error record rather than the uncaught crash this module's own
  // "never exits non-zero" contract promises not to produce.
  let record = { type: 'session', host: null, session_id: input.session_id ?? null, cwd, reason: input.reason ?? null };
  try {
    const host = hostArg();
    record.host = host;
    const { config, repo } = loadConfig(cwd);
    record.repo = repo;
    const files = instructionFiles(cwd, { host });
    record.instruction_lines = instructionTotal(files);
    record.instruction_files = files;
    if (host === 'codex') {
      const rollout = input.transcript_path && fs.existsSync(input.transcript_path) ? input.transcript_path : findRollout(input.session_id);
      if (rollout) Object.assign(record, summarizeRollout(fs.readFileSync(rollout, 'utf8')), { transcript: rollout });
      else record.error = 'rollout not found for session_id';
    } else if (input.transcript_path && fs.existsSync(input.transcript_path)) {
      Object.assign(record, summarizeTranscript(fs.readFileSync(input.transcript_path, 'utf8')));
    } else {
      record.error = 'transcript_path missing';
    }
    appendLog(config, record);
  } catch (e) {
    try { appendLog(loadConfig(cwd).config, { ...record, error: e.message }); } catch { /* nothing left to do */ }
  }
  process.exit(0);
}
