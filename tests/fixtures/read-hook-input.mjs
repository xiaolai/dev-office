import { readHookInput } from '../../scripts/lib/stdin.mjs';
process.stdout.write(JSON.stringify(readHookInput()));
