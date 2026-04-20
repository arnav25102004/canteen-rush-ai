const esbuild = require('esbuild');
const { readdirSync, statSync } = require('fs');
const path = require('path');

function getEntryPoints(dir) {
  const files = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) {
      files.push(...getEntryPoints(full));
    } else if (f.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

esbuild.buildSync({
  entryPoints: getEntryPoints('./src'),
  outdir: './dist',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  bundle: false,
});

console.log('Build complete ✅');
