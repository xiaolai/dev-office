import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// True when this module is the script node was started with, false when it is
// imported (by a test, for example). Compares real paths, not file names.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
