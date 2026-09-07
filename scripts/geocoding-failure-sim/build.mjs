import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const [, , srcDir, outFile] = process.argv;
if (!srcDir || !outFile) {
  console.error('usage: node build.mjs <srcDir> <outFile>');
  process.exit(2);
}

// HARNESS_DIR가 없으면 이 스크립트가 있는 디렉터리를 쓴다.
// (예전에는 필수였고, README 예시를 그대로 붙여넣으면 TypeError가 났다)
const harnessDir = process.env.HARNESS_DIR ?? import.meta.dirname;
const stub = path.resolve(harnessDir, 'idb-stub.js');

const entry = path.join(os.tmpdir(), `geocode-sim-entry-${process.pid}.js`);
fs.writeFileSync(entry, `
import { batchGeocode } from '${srcDir}/src/lib/batchGeocoder.ts';
import * as geo from '${srcDir}/src/lib/kakaoGeocoder.ts';
import * as addr from '${srcDir}/src/lib/addressParser.ts';
globalThis.__api = { batchGeocode, geo, addr };
`);

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_VWORLD_KEY': '"TESTKEY-0000"',
    'import.meta.env.VITE_KAKAO_REST_KEY': 'undefined',
  },
  plugins: [{
    name: 'stub-idb',
    setup(b) { b.onResolve({ filter: /geocodeCache$/ }, () => ({ path: stub })); },
  }],
});
fs.unlinkSync(entry);
console.error(`built ${outFile}`);
