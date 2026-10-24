// dev-office gen-codex [--check]
// Derives the Codex adapter from the Claude one so the two cannot drift:
//   claude/skills/<n>/SKILL.md  -> codex/skills/<n>/SKILL.md   (same open spec; Claude-only keys dropped)
//   claude/agents/<n>.md        -> codex/agents/<n>.toml        (name, description, developer_instructions, effort)
// --check writes nothing and exits 1 if any derived file differs from disk.
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './lib/config.mjs';
import { isMain } from './lib/main.mjs';

const CLAUDE_ONLY_SKILL_KEYS = new Set(['user-invocable', 'metadata', 'allowed-tools']);

// A deliberately narrow frontmatter reader: flat `key: value` pairs, plus one
// `key: |` literal block scalar per key (the shape nlpm's R09 rule requires
// for an agent description that carries an `<example>` block — the routing
// text has to live in the description, not the body, so a single-line quoted
// string stopped being enough once that rule applied). Anything richer still
// is rejected outright rather than silently misread: a nested `metadata:`
// block read as top-level keys, a `>` folded scalar, or a `|-`/`|+` chomping
// variant. Add a real YAML parser if a source ever needs more than this.
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('frontmatter missing');
  const fm = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || /^\s/.test(line)) continue; // blank, or indented: belongs to a parent key, not a new top-level field
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value === '|') {
      // Consume every following line indented by at least the first block
      // line's own indent; a line at or below that indent ends the block and
      // is left for the outer loop to parse as the next key. Trailing blank
      // lines are dropped (this plugin never relies on exact chomping).
      const block = [];
      let j = i + 1, indent = null;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l === '') { block.push(''); continue; }
        const lead = /^ */.exec(l)[0].length;
        if (indent === null) indent = lead;
        if (lead < indent) break;
        block.push(l.slice(indent));
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      fm[key] = block.join('\n');
      i = j - 1;
      continue;
    }
    if (/^[|>]/.test(value)) throw new Error(`frontmatter key "${key}" uses a YAML block scalar (${JSON.stringify(value)}), which this narrow reader does not support`);
    const quoted = /^"([\s\S]*)"$/.exec(value);
    if (quoted) value = quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    fm[key] = value;
  }
  return { fm, body: m[2] };
}

const tomlString = (s) => JSON.stringify(s);
const tomlMultiline = (s) => `"""\n${s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""').trimEnd()}\n"""`;

export function codexSkill(claudeText) {
  const { fm, body } = parseFrontmatter(claudeText);
  const keep = Object.entries(fm).filter(([k]) => !CLAUDE_ONLY_SKILL_KEYS.has(k));
  const head = keep.map(([k, v]) => `${k}: ${k === 'description' ? JSON.stringify(v) : v}`).join('\n');
  return `---\n${head}\n---\n${body}`;
}

export function codexAgent(claudeText) {
  const { fm, body } = parseFrontmatter(claudeText);
  for (const k of ['name', 'description', 'effort']) if (!fm[k]) throw new Error(`agent frontmatter lacks ${k}`);
  const lines = [
    `# Generated from claude/agents/${fm.name}.md by \`dev-office gen-codex\`. Do not edit; edit the source.`,
    `# \`model\` is omitted on purpose: Claude's model names mean nothing here, so the agent inherits`,
    `# the Codex default and only the reasoning effort carries over.`,
    `name = ${tomlString(fm.name)}`,
    `description = ${tomlString(fm.description)}`,
    `model_reasoning_effort = ${tomlString(fm.effort)}`,
    `developer_instructions = ${tomlMultiline(body.trim())}`,
  ];
  return lines.join('\n') + '\n';
}

export function derived() {
  const out = new Map();
  const skillsDir = path.join(PLUGIN_ROOT, 'claude', 'skills');
  for (const n of fs.readdirSync(skillsDir)) {
    const src = path.join(skillsDir, n, 'SKILL.md');
    if (fs.existsSync(src)) out.set(path.join('codex', 'skills', n, 'SKILL.md'), codexSkill(fs.readFileSync(src, 'utf8')));
  }
  const agentsDir = path.join(PLUGIN_ROOT, 'claude', 'agents');
  for (const f of fs.readdirSync(agentsDir)) {
    if (!f.endsWith('.md')) continue;
    out.set(path.join('codex', 'agents', f.replace(/\.md$/, '.toml')), codexAgent(fs.readFileSync(path.join(agentsDir, f), 'utf8')));
  }
  return out;
}

// A source renamed or deleted on the claude/ side leaves its old codex/
// counterpart on disk: `derived()` only ever looks forward from current
// sources, so it has no way to notice a file it no longer expects. This scans
// the actual codex/ tree and reports anything derived() did not just produce.
// Reported, not deleted automatically: removal is a decision for the caller.
export function orphans(expected) {
  const out = [];
  const skillsDir = path.join(PLUGIN_ROOT, 'codex', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const n of fs.readdirSync(skillsDir)) {
      const rel = path.join('codex', 'skills', n, 'SKILL.md');
      if (fs.existsSync(path.join(PLUGIN_ROOT, rel)) && !expected.has(rel)) out.push(rel);
    }
  }
  const agentsDir = path.join(PLUGIN_ROOT, 'codex', 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      const rel = path.join('codex', 'agents', f);
      if (f.endsWith('.toml') && !expected.has(rel)) out.push(rel);
    }
  }
  return out;
}

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check');
  const expected = derived();
  let stale = 0;
  for (const [rel, text] of expected) {
    const abs = path.join(PLUGIN_ROOT, rel);
    const same = fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === text;
    if (same) continue;
    stale += 1;
    if (check) { console.error(`stale    ${rel}`); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    console.log(`wrote    ${rel}`);
  }
  const orphaned = orphans(new Set(expected.keys()));
  for (const rel of orphaned) console.error(`orphan   ${rel} (source removed; not deleted here — remove it or re-add the source)`);
  stale += orphaned.length;
  if (check && stale) { console.error(`gen-codex: ${stale} derived file(s) out of date or orphaned; run dev-office gen-codex`); process.exit(1); }
  if (!stale) console.log('gen-codex: codex tree is up to date');
}
