import fs from 'node:fs';
import path from 'node:path';

export function appendLog(config, record) {
  const file = config.log.path;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  return file;
}

export function readLog(config, { sinceDays = null } = {}) {
  let text;
  try { text = fs.readFileSync(config.log.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const cutoff = sinceDays === null ? null : Date.now() - sinceDays * 86400000;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    // A line can be valid JSON and still not be a record: `null`, an array,
    // a bare number. Skip those rather than crash on `rec.ts` below.
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) continue;
    if (cutoff !== null) {
      const ts = Date.parse(rec.ts);
      // A missing or unparseable timestamp makes `NaN < cutoff` false, which
      // reads as "not before the cutoff" and kept the record — exactly
      // backwards for a filter whose job is to exclude what it cannot place
      // in the window. Require a finite timestamp to pass the filter at all.
      if (!Number.isFinite(ts) || ts < cutoff) continue;
    }
    out.push(rec);
  }
  return out;
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
