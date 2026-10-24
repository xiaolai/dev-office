// dev-office install
// Links the CLI into ~/.local/bin, prepares ~/.dev-office, copies the Codex
// agent files into ~/.codex/agents (Codex plugins carry skills and hooks but no
// agents), and prints the plugin install commands for both hosts. It edits
// nothing under ~/.claude: that directory is version-controlled by its owner
// and changes there go through a commit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_ROOT } from './lib/config.mjs';

const binDir = path.join(os.homedir(), '.local', 'bin');
const link = path.join(binDir, 'dev-office');
const target = path.join(PLUGIN_ROOT, 'scripts', 'dev-office');
fs.mkdirSync(binDir, { recursive: true });
const st = fs.lstatSync(link, { throwIfNoEntry: false });
if (st && !st.isSymbolicLink()) { console.error(`dev-office install: ${link} exists and is not a symlink; refusing to replace it`); process.exit(1); }
if (st) fs.unlinkSync(link);
fs.symlinkSync(target, link);
console.log(`linked   ${link} -> ${target}`);
const home = path.join(os.homedir(), '.dev-office');
fs.mkdirSync(home, { recursive: true });
console.log(`ready    ${home}`);
if (!(process.env.PATH ?? '').split(path.delimiter).includes(binDir)) console.log(`note     ${binDir} is not on PATH`);

// gen-codex.mjs stamps every file it writes with this marker. A destination
// that has it is ours to overwrite (even if stale); one without it was placed
// there by the user or another tool and must not be silently clobbered.
const GENERATED_MARKER = '# Generated from claude/agents/';
const codexAgents = path.join(PLUGIN_ROOT, 'codex', 'agents');
const codexHome = path.join(os.homedir(), '.codex', 'agents');
if (fs.existsSync(codexAgents)) {
  fs.mkdirSync(codexHome, { recursive: true });
  for (const f of fs.readdirSync(codexAgents).filter((n) => n.endsWith('.toml'))) {
    const src = fs.readFileSync(path.join(codexAgents, f), 'utf8');
    const dst = path.join(codexHome, f);
    const existing = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
    if (existing !== null && !existing.startsWith(GENERATED_MARKER)) {
      console.log(`skipped  ${dst} (not managed by dev-office; remove it or move it aside to let install manage it)`);
      continue;
    }
    const same = existing === src;
    if (!same) fs.writeFileSync(dst, src);
    console.log(`${same ? 'current ' : 'copied  '} ${dst}`);
  }
}
console.log(`
Install the plugin at user scope from this checkout:
  claude plugin marketplace add ${PLUGIN_ROOT}
  claude plugin install dev-office@agentic-dev-office-local

Install the Codex plugin from the same checkout (skills and hooks; agents were copied above):
  codex plugin marketplace add ${PLUGIN_ROOT}
  codex plugin add dev-office@agentic-dev-office-local
Then trust its two hooks once, in the Codex TUI: /hooks. Until then Codex skips them silently
and no codex session is logged (verified on 0.164.0).

Recommended caps in ~/.claude/settings.json "env" (deterministic, replaces prose):
  "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1"
  "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "4"
`);
