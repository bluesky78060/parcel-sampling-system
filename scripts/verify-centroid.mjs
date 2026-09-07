/**
 * computePolygonCentroid 정확도 검증 — 네트워크 없이 돈다.
 *
 * 2026-09-07: 절대좌표로 shoelace를 계산하던 탓에 작은 필지에서 centroid가 수 km
 * 날아갔다. 봉화군 좌표(lng 128·lat 36)에서 2m 필지의 cross 값은 4,750쯤 되는 두 수의
 * 차라 유효숫자가 상쇄된다. 실측 표본 1,600필지 중 **62%**의 centroid가 자기 폴리곤
 * 밖에 있었고 중앙값 오차가 22.5m였다.
 *
 * usage: node scripts/verify-centroid.mjs
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const tmp = os.tmpdir();
const out = path.join(tmp, `centroid-check-${process.pid}.mjs`);
const entry = path.join(tmp, `centroid-entry-${process.pid}.js`);
// 지오코딩 캐시는 브라우저 IndexedDB를 쓰므로 node에서는 스텁으로 대체한다
const stub = path.join(root, 'scripts/geocoding-failure-sim/idb-stub.js');

fs.writeFileSync(entry, `export { computePolygonCentroid } from '${root}/src/lib/kakaoGeocoder.ts';`);
await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: out,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_VWORLD_KEY': '""',
    'import.meta.env.VITE_KAKAO_REST_KEY': 'undefined',
  },
  plugins: [{
    name: 'stub-idb',
    setup(b) { b.onResolve({ filter: /geocodeCache$/ }, () => ({ path: stub })); },
  }],
});

const { computePolygonCentroid } = await import(out);
fs.unlinkSync(entry); fs.unlinkSync(out);

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[(i - 1 + ring.length) % ring.length];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const distM = (a, b) => Math.hypot((a.lng - b[0]) * 88000, (a.lat - b[1]) * 111000);

// 봉화군 실좌표대(lng 128.8 / lat 36.88)에서 크기별 정사각 필지를 만든다.
// 작을수록 상쇄 오차가 커지므로 2m까지 내려간다.
const BASE = [128.8162, 36.8829];
const cases = [];
for (const meters of [2, 5, 10, 20, 50, 100, 500]) {
  const dx = meters / 88000, dy = meters / 111000;
  const [x, y] = BASE;
  cases.push({
    name: `${meters}m 정사각`,
    ring: [[x, y], [x + dx, y], [x + dx, y + dy], [x, y + dy], [x, y]],
    expect: { lng: x + dx / 2, lat: y + dy / 2 },
  });
}
// 실제로 8km 날아갔던 필지 (봉성면 봉성리 388-12)
cases.push({
  name: '실측 2m 삼각형 (봉성리 388-12)',
  ring: [
    [128.81625989670147, 36.88291157522876],
    [128.8162329142415, 36.88289509723671],
    [128.81623416564335, 36.882911066551365],
    [128.81625989670147, 36.88291157522876],
  ],
});
// 실제로 26km 날아갔던 필지 (소천면 분천리 99-11, PNU 4792035027100990011).
// 옛 centroid가 lng 129.37416을 냈고, 그 값이 "봉화군 동단 실측"으로 오인되어
// 경계 상수를 129.45까지 넓히는 근거가 됐다. 봉화군 동단은 실제로 129.186이다.
cases.push({
  name: '실측 5m 삼각형 (분천리 99-11, 26km 이탈)',
  ring: [
    [129.09462693532097, 36.94488017762701],
    [129.0945653667868, 36.94485885216217],
    [129.09462592686248, 36.94488174630446],
    [129.09462693532097, 36.94488017762701],
  ],
});

// ── 퇴화·비정형 입력 ──
// usePolygonLayer와 prefetch가 링 길이만 확인하고 넘기므로, 점·선 입력에서
// NaN이나 무한대가 나오면 마커가 사라지거나 (0,0)으로 튄다.
{
  const [x, y] = BASE;
  const m = (mx, my) => [x + mx / 88000, y + my / 111000];
  const deg = (mx, my) => ({ lng: x + mx / 88000, lat: y + my / 111000 });

  // 오목 L자: [0,40]×[0,20] ∪ [0,20]×[20,60] (m). 두 직사각형 면적이 같으므로
  // centroid는 두 중심 (20,10)·(10,40)의 중점 (15,25)다.
  cases.push({
    name: '오목 L자 (해석해 (15,25)m)',
    ring: [m(0, 0), m(40, 0), m(40, 20), m(20, 20), m(20, 60), m(0, 60), m(0, 0)],
    expect: deg(15, 25),
  });
  // 닫는 점이 없는 링 — VWorld는 닫아서 주지만, 함수는 어느 쪽이든 같아야 한다
  cases.push({
    name: '닫지 않은 10m 정사각',
    ring: [m(0, 0), m(10, 0), m(10, 10), m(0, 10)],
    expect: deg(5, 5),
  });
  // 폴백 경로: 면적 0
  cases.push({ name: '점 1개', ring: [m(3, 4)], expect: deg(3, 4), degenerate: true });
  cases.push({ name: '점 2개 (선분)', ring: [m(0, 0), m(10, 0)], expect: deg(5, 0), degenerate: true });
  cases.push({
    name: '공선 3점',
    ring: [m(0, 0), m(10, 10), m(30, 30), m(0, 0)],
    // 폴백은 단순 평균(닫는 점 포함 4점)이다: (0+10+30+0)/4 = 10
    expect: deg(10, 10),
    degenerate: true,
  });
  // 빈 링: 호출부가 막지만, 새면 유한한 값이어야 한다(NaN이면 isValidBonghwaCoord가
  // false를 돌려주고 조용히 버려지는데, 그 이유를 아무도 모르게 된다)
  cases.push({ name: '빈 링', ring: [], expect: { lng: 0, lat: 0 }, degenerate: true });
}

let failed = 0;
console.log('케이스                                      centroid 오차   폴리곤 안?');
for (const c of cases) {
  const got = computePolygonCentroid(c.ring);
  const finite = Number.isFinite(got.lat) && Number.isFinite(got.lng);
  // 퇴화 도형은 "안"이 정의되지 않는다. 유한값 + 기대값 일치만 본다.
  const inside = c.degenerate ? null : finite && pointInRing([got.lng, got.lat], c.ring);
  const err = c.expect && finite
    ? Math.hypot((got.lng - c.expect.lng) * 88000, (got.lat - c.expect.lat) * 111000)
    : null;
  // 실측 링(expect 없음)은 볼록 도형이므로 centroid가 반드시 안에 있어야 한다.
  const bad = !finite || inside === false || (c.expect && (err === null || err > 0.5));
  if (bad) failed++;
  console.log(
    `  ${c.name.padEnd(42)} ${err === null ? '     -   ' : `${err.toFixed(3).padStart(8)}m`}   ` +
    `${inside === null ? '-' : inside ? '✓' : '✗'}${finite ? '' : '  (NaN/∞)'}`
  );
}
if (failed) {
  console.error(`\n${failed}건 실패 — centroid가 폴리곤 밖이거나, 오차가 0.5m를 넘거나, 유한값이 아닙니다.`);
  process.exit(1);
}
console.log('\n전체 통과.');
