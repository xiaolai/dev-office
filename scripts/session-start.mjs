// SessionStart hook. Prints one budget line and the orchestration rules. Both
// land in the session context, so this output is itself counted in the budget.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, PLUGIN_ROOT } from './lib/config.mjs';
import { instructionFiles, instructionTotal } from './lib/instructions.mjs';
import { readHookInput, hostArg } from './lib/stdin.mjs';

try {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  const { config } = loadConfig(cwd);
  const files = instructionFiles(cwd, { host: hostArg() });
  const total = instructionTotal(files);
  const cap = config.budget.instruction_lines;
  const state = total > cap ? `OVER by ${total - cap}` : 'ok';
  console.log(`dev-office: instructions ${total} lines across ${files.length} files (cap ${cap}) ${state}`);
  console.log('dev-office rules:');
  console.log(fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', 'orchestration.md'), 'utf8').trimEnd());
} catch (e) {
  console.log(`dev-office: session-start skipped (${e.message})`);
}
process.exit(0);
