// dev-office env-audit
// Lists exported variables that look like credentials by name or by value
// shape. Prints names only. Exit 1 when any are found so it can gate a launcher.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { isMain } from './lib/main.mjs';

const NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE)/i;
const NAME_BENIGN = /^(SSH_AUTH_SOCK|GPG_TTY|XDG_[A-Z_]+|AUTHOR|AUTHORS?_[A-Z_]+|LSCOLORS|KEYMAP|KEYBOARD[A-Z_]*|TERM_SESSION_ID|SECURITYSESSIONID)$/;
const VALUE = [
  /^gh[pousr]_[A-Za-z0-9]{20,}/, /^github_pat_[A-Za-z0-9_]{20,}/, /^sk-[A-Za-z0-9_-]{20,}/, /^xox[abprs]-[A-Za-z0-9-]{10,}/,
  /^AKIA[0-9A-Z]{16}/, /^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/, /^-----BEGIN /, /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /^(glpat|npm_|dop_v1_|pypi-|hf_|AIza)[A-Za-z0-9_-]{16,}/,
];
const GENERIC = /^[A-Za-z0-9_=+-]{40,}$/;

export function audit(env, allow = []) {
  const findings = [];
  for (const [name, value] of Object.entries(env)) {
    if (allow.includes(name)) continue;
    // A benign name (XDG_*, AUTHOR, ...) exempts the NAME check only: it does
    // not excuse the value from the shape scan, so a credential that happens
    // to be assigned to a benignly-named variable (XDG_API_TOKEN) still trips
    // on VALUE/GENERIC. Only `allow`, above, is a full exemption.
    const byName = !NAME_BENIGN.test(name) && NAME.test(name);
    const byValue = typeof value === 'string' && (VALUE.some((re) => re.test(value)) || GENERIC.test(value));
    if (byName || byValue) findings.push({ name, matched: byName && byValue ? 'name and value' : byName ? 'name' : 'value', length: value?.length ?? 0 });
  }
  return findings.sort((a, b) => a.name.localeCompare(b.name));
}

// Reports which credential-control fields are present and non-empty, never
// their contents: a names-only audit must not become a channel for whatever
// a user typed into claude settings.json, even if that file is expected to
// hold only variable names rather than secret values.
export function summarizeSandboxCredentials(settings) {
  const c = settings?.sandbox?.credentials;
  if (!c || typeof c !== 'object') return 'not configured';
  const describe = (v) => (Array.isArray(v) ? `${v.length} entr${v.length === 1 ? 'y' : 'ies'}` : v && typeof v === 'object' ? `${Object.keys(v).length} key(s)` : v ? 'set' : 'unset');
  return Object.entries(c).map(([k, v]) => `${k}: ${describe(v)}`).join(', ') || 'empty';
}

if (isMain(import.meta.url)) {
  const { config } = loadConfig();
  const findings = audit(process.env, config.env_audit.allow);
  let sandbox = 'not configured';
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    sandbox = summarizeSandboxCredentials(s);
  } catch { /* no settings */ }
  console.log(`dev-office env-audit: ${findings.length} exported variable(s) of credential shape (values never printed)`);
  for (const f of findings) console.log(`  ${f.name.padEnd(36)} matched by ${f.matched}, ${f.length} chars`);
  console.log(`claude sandbox.credentials: ${sandbox}`);
  if (findings.length) {
    console.log('Goal state is zero: load secrets per command (op run, Keychain) instead of exporting them in the launching shell. Known-benign names go in env_audit.allow.');
    process.exit(1);
  }
}
