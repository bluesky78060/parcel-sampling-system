/**
 * BONGHWA_BOUNDS 실측 검증 — VWorld 시군구 경계와 대조한다.
 *
 * 이 상수는 지오코딩 결과와 마커 표시 양쪽의 관문이다. 너무 좁으면 실제 필지가
 * "범위 밖"으로 버려지고(마커 안 찍힘), 너무 넓으면 옆 군 좌표가 통과한다(엉뚱한
 * 곳에 마커). 2026-09-04에는 centroid 버그가 만든 26km 이탈 좌표(lng 129.374)를
 * "실측 동단"으로 믿고 동쪽을 129.45까지 넓혔다 — 봉화군 동단은 129.186이다.
 *
 * 두 방향을 모두 검사한다:
 *   1. 상수가 군 경계 bbox를 포함하는가 (안 하면 실제 필지가 잘린다)
 *   2. 각 변의 여유가 MARGIN_MIN~MARGIN_MAX 안인가 (너무 크면 옆 군이 새고,
 *      너무 작으면 경계 단순화·오목 필지 centroid가 걸린다)
 *
 * usage: node scripts/verify-bounds.mjs [--referer=https://...]
 * .env의 VITE_VWORLD_KEY를 읽는다. VWorld는 Referer가 없으면 INCORRECT_KEY를 돌려준다.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const REFERER = process.argv.find(a => a.startsWith('--referer='))?.split('=')[1]
  ?? 'https://bluesky78060.github.io';

/** 여유 허용 범위 (deg). 0.005 ≈ 0.5km, 0.05 ≈ 4.5~5.5km */
const MARGIN_MIN = 0.005;
const MARGIN_MAX = 0.05;

function readKey() {
  if (process.env.VITE_VWORLD_KEY) return process.env.VITE_VWORLD_KEY.trim();
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return '';
  const m = fs.readFileSync(envPath, 'utf-8').match(/^VITE_VWORLD_KEY\s*=\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const key = readKey();
if (!key) {
  console.error('VITE_VWORLD_KEY를 찾지 못했습니다 (.env 또는 환경변수).');
  process.exit(2);
}

// 소스에서 상수를 읽는다 (esbuild 없이). 형식이 바뀌면 여기서 바로 실패한다.
const src = fs.readFileSync(path.join(root, 'src/lib/bonghwaBounds.ts'), 'utf-8');
const bounds = {};
for (const k of ['latMin', 'latMax', 'lngMin', 'lngMax']) {
  const m = src.match(new RegExp(`${k}:\\s*([0-9.]+)`));
  if (!m) { console.error(`bonghwaBounds.ts에서 ${k}를 읽지 못했습니다`); process.exit(2); }
  bounds[k] = Number(m[1]);
}

const url = 'https://api.vworld.kr/req/data?service=data&request=GetFeature'
  + `&data=LT_C_ADSIGG_INFO&key=${key}&format=json&geometry=true&crs=EPSG:4326`
  + '&attrFilter=sig_cd:=:47920&size=10';
const res = await fetch(url, { headers: { Referer: REFERER } });
const json = await res.json();
const r = json.response;
if (r?.status !== 'OK') {
  console.error(`VWorld 조회 실패: ${r?.error?.text ?? r?.status}`);
  process.exit(2);
}
const features = r.result?.featureCollection?.features ?? [];
if (features.length === 0) {
  console.error('시군구 경계가 비어 있습니다 (sig_cd=47920)');
  process.exit(2);
}

const real = { lngMin: Infinity, lngMax: -Infinity, latMin: Infinity, latMax: -Infinity };
const walk = (c) => {
  if (typeof c[0] === 'number') {
    real.lngMin = Math.min(real.lngMin, c[0]); real.lngMax = Math.max(real.lngMax, c[0]);
    real.latMin = Math.min(real.latMin, c[1]); real.latMax = Math.max(real.latMax, c[1]);
  } else {
    c.forEach(walk);
  }
};
for (const f of features) walk(f.geometry.coordinates);

const margins = {
  latMin: bounds.latMin <= real.latMin ? real.latMin - bounds.latMin : -(bounds.latMin - real.latMin),
  latMax: bounds.latMax >= real.latMax ? bounds.latMax - real.latMax : -(real.latMax - bounds.latMax),
  lngMin: bounds.lngMin <= real.lngMin ? real.lngMin - bounds.lngMin : -(bounds.lngMin - real.lngMin),
  lngMax: bounds.lngMax >= real.lngMax ? bounds.lngMax - real.lngMax : -(real.lngMax - bounds.lngMax),
};
const kmOf = (k, deg) => (deg * (k.startsWith('lat') ? 111 : 88)).toFixed(2);

console.log(`군 경계 실측: ${features.map(f => f.properties?.full_nm).join(', ')}`);
console.log(`  lat ${real.latMin.toFixed(5)} ~ ${real.latMax.toFixed(5)} / lng ${real.lngMin.toFixed(5)} ~ ${real.lngMax.toFixed(5)}`);
console.log(`BONGHWA_BOUNDS: lat ${bounds.latMin} ~ ${bounds.latMax} / lng ${bounds.lngMin} ~ ${bounds.lngMax}\n`);

let failed = 0;
for (const [k, m] of Object.entries(margins)) {
  let verdict;
  if (m < 0) verdict = `✗ 경계를 ${kmOf(k, -m)}km 잘라낸다 — 실제 필지가 범위 밖으로 버려진다`;
  else if (m < MARGIN_MIN) verdict = `✗ 여유 ${kmOf(k, m)}km — 너무 좁다 (최소 ${kmOf(k, MARGIN_MIN)}km)`;
  else if (m > MARGIN_MAX) verdict = `✗ 여유 ${kmOf(k, m)}km — 너무 넓다 (최대 ${kmOf(k, MARGIN_MAX)}km), 옆 군 좌표가 통과한다`;
  else verdict = `✓ 여유 ${kmOf(k, m)}km`;
  if (verdict.startsWith('✗')) failed++;
  console.log(`  ${k.padEnd(7)} ${verdict}`);
}

if (failed) {
  console.error(`\n${failed}건 실패 — BONGHWA_BOUNDS가 실측과 맞지 않습니다.`);
  process.exit(1);
}
console.log('\n경계 상수가 실측과 일치합니다.');
