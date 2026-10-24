import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT } from '../scripts/lib/config.mjs';

const read = (p) => fs.readFileSync(path.join(PLUGIN_ROOT, p), 'utf8');
const frontmatter = (text) => { const m = /^---\n([\s\S]*?)\n---/.exec(text); assert.ok(m, 'frontmatter present'); return Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })); };
const lines = (text) => text.split('\n').length;

test('claude manifest paths exist and hooks only call the dispatcher', () => {
  const m = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(m.name, 'dev-office');
  for (const k of ['skills', 'hooks']) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, m[k])), `${k}: ${m[k]}`);
  assert.ok(Array.isArray(m.agents) && m.agents.every((a) => a.endsWith('.md') && fs.existsSync(path.join(PLUGIN_ROOT, a))), 'agents is a list of existing .md files');
  const hooks = JSON.parse(read(m.hooks)).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionEnd', 'SessionStart']);
  for (const list of Object.values(hooks)) for (const g of list) for (const h of g.hooks) assert.match(h.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/dev-office" (session-start|log-session)$/);
});

test('agents are short, carry model and effort, and are only the three roles', () => {
  const dir = path.join(PLUGIN_ROOT, 'claude', 'agents');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['implementer.md', 'planner.md', 'verifier.md']);
  for (const f of fs.readdirSync(dir)) {
    const text = read(path.join('claude/agents', f));
    const fm = frontmatter(text);
    assert.equal(fm.name + '.md', f); assert.ok(fm.description); assert.ok(fm.model); assert.ok(fm.effort);
    // Cap raised from 15 to 22: nlpm's R09 rule requires one <example> block
    // (Context + user + assistant, 5 lines minimum) inside the description
    // itself, not the body, because that is the only part of an agent file
    // Claude Code shows on every turn when choosing which agent to dispatch.
    assert.ok(lines(text) <= 22, `${f} is ${lines(text)} lines; cap is 22`);
  }
});

test('skills are thin wrappers under 40 lines that call the dispatcher', () => {
  const dir = path.join(PLUGIN_ROOT, 'claude', 'skills');
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['adr', 'release', 'repo-init', 'tidy']);
  for (const n of names) {
    const text = read(path.join('claude/skills', n, 'SKILL.md'));
    const fm = frontmatter(text);
    assert.equal(fm.name, n); assert.ok(fm.description.length > 40);
    assert.ok(lines(text) <= 40, `${n} is ${lines(text)} lines; cap is 40`);
    assert.match(text, /dev-office /, `${n} calls the dispatcher`);
  }
});

test('the rules file is exactly twelve numbered lines', () => {
  const rules = read('rules/orchestration.md').trim().split('\n');
  assert.equal(rules.length, 12);
  rules.forEach((l, i) => assert.ok(l.startsWith(`${i + 1}. `), l));
});

test('every dispatcher command has a script', () => {
  const d = read('scripts/dev-office');
  const cmds = /^\s+(config\|[^)]+)\)/m.exec(d)[1].split('|');
  for (const c of cmds) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', `${c}.mjs`)), `scripts/${c}.mjs`);
});

test('codex tree mirrors the claude tree and is exactly what the generator derives', () => {
  const codex = path.join(PLUGIN_ROOT, 'codex');
  assert.ok(fs.existsSync(codex), 'codex tree present');
  const claudeSkills = fs.readdirSync(path.join(PLUGIN_ROOT, 'claude', 'skills')).sort();
  const codexSkills = fs.readdirSync(path.join(codex, 'skills')).sort();
  assert.deepEqual(codexSkills, claudeSkills, 'same skill names');
  for (const s of codexSkills) {
    assert.ok(!fs.lstatSync(path.join(codex, 'skills', s)).isSymbolicLink(), `${s} must be a real directory: codex drops symlinked skills on install`);
    const fm = frontmatter(read(path.join('codex/skills', s, 'SKILL.md')));
    assert.equal(fm.name, s); assert.ok(fm.description); assert.equal(fm['user-invocable'], undefined, 'claude-only key dropped');
  }
  const claudeAgents = fs.readdirSync(path.join(PLUGIN_ROOT, 'claude', 'agents')).map((f) => f.replace(/\.md$/, '')).sort();
  const codexAgents = fs.readdirSync(path.join(codex, 'agents')).map((f) => f.replace(/\.toml$/, '')).sort();
  assert.deepEqual(codexAgents, claudeAgents, 'same agent names');
  for (const a of codexAgents) {
    const t = read(path.join('codex/agents', `${a}.toml`));
    assert.match(t, new RegExp(`^name = "${a}"$`, 'm')); assert.match(t, /^model_reasoning_effort = "(low|medium|high|xhigh)"$/m); assert.match(t, /^developer_instructions = """$/m);
    assert.doesNotMatch(t, /^model = /m, 'model is inherited, not copied from claude');
  }
  const claudeHooks = JSON.parse(read('claude/hooks/hooks.json')).hooks;
  const codexHooks = JSON.parse(read('codex/hooks.json')).hooks;
  assert.deepEqual(Object.keys(codexHooks).sort(), Object.keys(claudeHooks).sort(), 'same hook events');
  for (const [ev, list] of Object.entries(codexHooks)) for (const g of list) for (const h of g.hooks) {
    assert.match(h.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/dev-office" (session-start|log-session) --host codex$/);
    if (ev === 'SessionEnd') assert.ok(h.timeout <= 3, 'codex SessionEnd allows at most 3 seconds');
  }
  const m = JSON.parse(read('.codex-plugin/plugin.json'));
  assert.equal(m.name, 'dev-office');
  assert.deepEqual(m.commands, [], 'codex must not convert claude commands into skills');
  assert.equal(m.skills, './codex/skills/'); assert.equal(m.hooks, './codex/hooks.json');
  assert.equal(JSON.parse(read('.agents/plugins/marketplace.json')).plugins[0].name, 'dev-office');
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'gen-codex.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `codex tree drifted from claude tree:\n${r.stderr}`);
});
