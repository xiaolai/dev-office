// Configuration resolver. Four layers, later wins; arrays and scalars replace,
// objects merge. Every script reads through loadConfig(); none opens a file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './git.mjs';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function layers(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const list = [
    { name: 'defaults', file: path.join(PLUGIN_ROOT, 'defaults.json') },
    { name: 'user', file: path.join(os.homedir(), '.dev-office', 'config.json') },
  ];
  if (root) {
    list.push({ name: 'repo', file: path.join(root, '.dev-office.json') });
    list.push({ name: 'repo-local', file: path.join(root, '.dev-office.local.json') });
  }
  return list;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${file}: invalid JSON (${e.message})`); }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Keys that are safe as JSON data but dangerous as object keys: assigning
// through them (`target['__proto__'] = v`) mutates the prototype chain rather
// than adding an own property. A config layer is untrusted JSON, so these are
// rejected rather than merged.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// A repo's `.dev-office.json` travels with the repo and is as untrusted as
// its code. Only the defaults and user layers may set these: `log.path` and
// `adr.dir` choose a filesystem location that a hook or command then writes
// to or reads from, so a cloned repo cannot redirect a write outside itself
// unnoticed; `jev.enabled` turns on sending diff content to an external
// calibration service, so a cloned repo cannot opt the user into that
// without them choosing it themselves.
const REPO_RESTRICTED_KEYS = new Set(['log.path', 'adr.dir', 'jev.enabled', 'jev.docket']);

// A docket name is a bare identifier, never shell syntax. Checked at load
// time, the one place every consumer of config.jev.docket passes through,
// so a value that could break out of `jev docket <name>` is rejected before
// any script or skill ever builds that command line.
const JEV_DOCKET_PATTERN = /^[a-z0-9-]+$/;

function merge(target, source, layer, provenance, prefix) {
  const repoScoped = layer === 'repo' || layer === 'repo-local';
  for (const [k, v] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (repoScoped && REPO_RESTRICTED_KEYS.has(key)) continue;
    if (isObject(v) && isObject(target[k])) {
      merge(target[k], v, layer, provenance, key);
    } else if (isObject(v)) {
      target[k] = {};
      merge(target[k], v, layer, provenance, key);
    } else {
      target[k] = Array.isArray(v) ? v.slice() : v;
      provenance.set(key, layer);
    }
  }
}

export function loadConfig(cwd = process.cwd()) {
  const config = {};
  const provenance = new Map();
  const files = [];
  for (const layer of layers(cwd)) {
    const data = readJson(layer.file);
    if (data === null) continue;
    if (!isObject(data)) throw new Error(`${layer.file}: top level must be an object`);
    files.push(layer);
    merge(config, data, layer.name, provenance, '');
  }
  if (config.log) config.log.path = expandHome(config.log.path);
  if (config.jev && config.jev.docket !== null && config.jev.docket !== undefined && !JEV_DOCKET_PATTERN.test(config.jev.docket)) {
    throw new Error(`jev.docket: "${config.jev.docket}" is not a bare identifier (must match ${JEV_DOCKET_PATTERN})`);
  }
  return { config, provenance, files, repo: repoRoot(cwd) };
}

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) flatten(v, key, out); else out[key] = v;
  }
  return out;
}
