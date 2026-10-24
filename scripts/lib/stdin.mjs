import fs from 'node:fs';

// Hook input arrives as JSON on stdin. A hook must never fail because stdin was
// empty or malformed, so this returns {} rather than throwing. Valid JSON that
// is not an object (`null`, `42`, `[1,2]`) is also treated as absent: callers
// read fields like `input.cwd` without first checking the shape, trusting
// this function's "never fails" contract — a bare `null` passed through would
// have broken that the first time a caller touched a property on it.
export function readHookInput() {
  try {
    const text = fs.readFileSync(0, 'utf8');
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Hook adapters pass the host explicitly: `dev-office log-session --host codex`.
// Claude is the default so the Claude hooks file stays as it was. A trailing
// `--host` with nothing after it, or a value that is not a known host, is
// rejected rather than silently falling through to the Claude branch under a
// host name that was never actually validated.
export function hostArg(argv = process.argv.slice(2), { valid = ['claude', 'codex'] } = {}) {
  const i = argv.indexOf('--host');
  if (i < 0) return 'claude';
  const value = argv[i + 1];
  if (!valid.includes(value)) throw new Error(`--host requires one of: ${valid.join(', ')} (got ${JSON.stringify(value)})`);
  return value;
}
