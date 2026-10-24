// Standing instruction files a session loads, per host. Claude Code: the global
// file and rules, CLAUDE.md in the working directory and every ancestor, project
// rules. Codex: ~/.codex/AGENTS.md and AGENTS.md from the repository root down to
// the working directory. Both: this plugin's own orchestration rules.
// Deduplicated by real path so a symlinked AGENTS.md is counted once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_ROOT } from './config.mjs';
import { repoRoot } from './git.mjs';

function lineCount(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
}

function mdFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export const HOSTS = ['claude', 'codex'];

export function instructionFiles(cwd = process.cwd(), { home = os.homedir(), host = 'claude' } = {}) {
  if (!HOSTS.includes(host)) throw new Error(`unknown host ${host}`);
  const candidates = [];
  if (host === 'claude') {
    candidates.push(path.join(home, '.claude', 'CLAUDE.md'), ...mdFiles(path.join(home, '.claude', 'rules')));
  } else {
    candidates.push(path.join(home, '.codex', 'AGENTS.md'));
  }
  let dir = path.resolve(cwd);
  // Claude Code loads CLAUDE.md from every ancestor up to the filesystem
  // root, so that walk is intentional. Codex scopes AGENTS.md discovery to
  // the repository (`project_doc_max_bytes` et al. are repo-relative), so its
  // walk stops at the repo root instead — and if `cwd` is not inside a repo
  // at all, there is no boundary to walk to, so only `cwd` itself is checked.
  const codexRoot = host === 'codex' ? repoRoot(cwd) : null;
  for (;;) {
    if (host === 'claude') {
      candidates.push(path.join(dir, 'CLAUDE.md'), path.join(dir, '.claude', 'CLAUDE.md'));
      candidates.push(...mdFiles(path.join(dir, '.claude', 'rules')));
    } else {
      candidates.push(path.join(dir, 'AGENTS.md'));
      if (codexRoot === null || dir === codexRoot) break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(path.join(PLUGIN_ROOT, 'rules', 'orchestration.md'));

  const seen = new Set();
  const files = [];
  for (const c of candidates) {
    let real;
    try { real = fs.realpathSync(c); } catch { continue; }
    if (seen.has(real) || !fs.statSync(real).isFile()) continue;
    seen.add(real);
    files.push({ file: c, lines: lineCount(real) });
  }
  return files;
}

export function instructionTotal(files) {
  return files.reduce((n, f) => n + f.lines, 0);
}
