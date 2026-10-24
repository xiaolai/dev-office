import { loadConfig, flatten } from './lib/config.mjs';

const json = process.argv.includes('--json');
const { config, provenance, files, repo } = loadConfig();
if (json) {
  process.stdout.write(JSON.stringify({ repo, files: files.map((f) => f.file), config, provenance: Object.fromEntries(provenance) }, null, 2) + '\n');
} else {
  console.log(`repository: ${repo ?? '(none)'}`);
  console.log('layers read:');
  for (const f of files) console.log(`  ${f.name.padEnd(10)} ${f.file}`);
  console.log('effective:');
  const flat = flatten(config);
  const width = Math.max(...Object.keys(flat).map((k) => k.length));
  for (const [k, v] of Object.entries(flat)) {
    console.log(`  ${k.padEnd(width)}  ${JSON.stringify(v)}  [${provenance.get(k) ?? 'defaults'}]`);
  }
}
